import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect
from app.routers import auth, students, supervisors, config, reports, calendar, backup as backup_router, zoom, trials, workflow, ai, gantt, knowledge, schedule_events, group_classes, student_import, nag as nag_router, admin as admin_router, hr_sync as hr_sync_router, notify as notify_router, checklist
from app.database import engine, SessionLocal, DATABASE_URL
from app import models, nag, notify


BACKEND_ROOT = Path(__file__).resolve().parent.parent

# Check workflow scheduler this often. Inside the helper we still only create a
# new pending row when 14 days have passed, so this just controls timeliness.
SCHEDULER_CHECK_INTERVAL_SECONDS = 60 * 60 * 6  # every 6h
BACKUP_INTERVAL_SECONDS = 60 * 60 * 24  # every 24h
NAG_CHECK_INTERVAL_SECONDS = 60 * 10  # every 10min; fire once per workday 09:00 CN
NAG_HOUR = 9  # 北京时间每工作日触发的整点
# 上课提醒：每 30s 扫一次。课前 15 分钟提醒精确到分钟，间隔必须 < 60s 否则会漏。
NOTIFY_CHECK_INTERVAL_SECONDS = 30
# 每日汇总只在设定时间之后这么多分钟内补发，过了就算今天错过（避免开关/重启触发补推）
NOTIFY_DIGEST_WINDOW_MINUTES = 10


async def _backup_loop():
    """每 24 小时自动备份一次到磁盘。"""
    while True:
        await asyncio.sleep(BACKUP_INTERVAL_SECONDS)
        try:
            db = SessionLocal()
            try:
                # 每个租户各备各的 —— 备份目录按 tutor_id 分子目录
                for tutor in db.query(models.Tutor).all():
                    backup_router.run_backup(db, tutor)
            finally:
                db.close()
        except Exception:
            pass


async def _scheduler_loop():
    """Background task: periodically check if a new workflow analysis is due."""
    while True:
        try:
            db = SessionLocal()
            try:
                for tutor in db.query(models.Tutor).all():
                    workflow.maybe_create_pending_analysis(db, tutor)
            finally:
                db.close()
        except Exception:
            pass  # never let scheduler crash the loop
        await asyncio.sleep(SCHEDULER_CHECK_INTERVAL_SECONDS)


async def _notify_loop():
    """上课提醒：每日汇总 + 课前 15 分钟。总开关关掉就整个跳过。

    去重靠内存里的两个集合，所以重启后当分钟内可能重复推一次——单人自用，
    不值得为这个再加一张表。
    """
    sent_digest_on: dict[str, object] = {}   # tutor_id -> date
    sent_leads: set[str] = set()             # 键已含 tutor_id
    while True:
        try:
            now = nag.datetime.now(nag.CN_TZ)
            db = SessionLocal()
            try:
                for tutor in db.query(models.Tutor).all():
                    cfg = notify.settings_of(tutor)
                    if not (cfg["enabled"] and cfg["webhookUrl"]):
                        continue
                    # 每日汇总：设定时间后 10 分钟内触发，今天只发一次。
                    # 用窗口而不是「≥ 设定时间」——否则下午才打开开关、或者傍晚重启，
                    # 都会立刻补推一条早上的汇总。
                    hhmm = notify.parse_hhmm(cfg["digestTime"])
                    if hhmm and sent_digest_on.get(tutor.id) != now.date():
                        delta = (now.hour * 60 + now.minute) - (hhmm[0] * 60 + hhmm[1])
                        if 0 <= delta < NOTIFY_DIGEST_WINDOW_MINUTES:
                            notify.run_digest(db, tutor)
                            sent_digest_on[tutor.id] = now.date()

                    # 课前 15 分钟
                    for key, content in notify.due_lead_reminders(db, now, tutor):
                        if key in sent_leads:
                            continue
                        result = notify.send(cfg["webhookUrl"], content)
                        notify.log.info("课前提醒 %s -> %s", key, result)
                        sent_leads.add(key)

                # 集合只留今天的键，别无限涨
                today_prefix = now.date().isoformat()
                sent_leads = {k for k in sent_leads if k.startswith(today_prefix)}
            finally:
                db.close()
        except Exception:
            # 不中断循环，但要留痕——静默失败的通知功能等于没有
            notify.log.exception("上课提醒循环异常")
        await asyncio.sleep(NOTIFY_CHECK_INTERVAL_SECONDS)


async def _nag_loop():
    """每工作日 09:00(北京时间) 推送一次催促提醒。每 10min 检查，当天只发一次。"""
    last_sent_date = None
    while True:
        try:
            now = nag.datetime.now(nag.CN_TZ)
            today = now.date()
            # 周一~周五(weekday<5)、9 点整那个小时、且今天还没发过
            if now.weekday() < 5 and now.hour == NAG_HOUR and last_sent_date != today:
                db = SessionLocal()
                try:
                    for tutor in db.query(models.Tutor).all():
                        nag.run_nag(db, tutor)
                finally:
                    db.close()
                last_sent_date = today
        except Exception:
            pass  # 定时任务永不因异常中断
        await asyncio.sleep(NAG_CHECK_INTERVAL_SECONDS)


BASELINE_REVISION = "0001_baseline"


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
    return cfg


def run_migrations() -> None:
    """启动时把库推到最新 schema。

    取代原先 lifespan 里那串吞异常的裸 ALTER TABLE：迁移失败会直接让服务起不来，
    而不是悄悄跳过、留下一个和代码对不上的库。

    引入 Alembic 之前建立的库（生产库、各开发机上的旧 SQLite 文件）已经有全部表
    但没有 alembic_version。对它们直接跑 upgrade 会因为 baseline 重建已存在的表
    而失败，所以这里先自动 stamp 到 baseline 再 upgrade —— 否则"先部署、后 stamp"
    的顺序一旦弄反，服务就起不来。

    判据是"有 tutors 表但没有 alembic_version"：全新库两者都没有，走正常 upgrade。
    """
    cfg = _alembic_config()
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and "tutors" in tables:
        command.stamp(cfg, BASELINE_REVISION)
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()

    # Initial check at startup, then schedule recurring checks
    db = SessionLocal()
    try:
        for tutor in db.query(models.Tutor).all():
            workflow.maybe_create_pending_analysis(db, tutor)
    finally:
        db.close()

    task = asyncio.create_task(_scheduler_loop())
    backup_task = asyncio.create_task(_backup_loop())
    nag_task = asyncio.create_task(_nag_loop())
    notify_task = asyncio.create_task(_notify_loop())
    try:
        yield
    finally:
        task.cancel()
        backup_task.cancel()
        nag_task.cancel()
        notify_task.cancel()


app = FastAPI(title="EPQ Tutor API", lifespan=lifespan)

_ALLOWED_ORIGINS = [
    "https://epq.simonevo.top",
    "https://gantt.simonevo.top",
    # local dev
    "http://localhost:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin_router.router)
app.include_router(hr_sync_router.router)
# 放在 students 之前：/api/students/import/* 比 /api/students/{student_id} 更具体
app.include_router(student_import.router)
app.include_router(students.router)
app.include_router(supervisors.router)
app.include_router(config.router)
app.include_router(reports.router)
app.include_router(calendar.router)
app.include_router(backup_router.router)
app.include_router(zoom.router)
app.include_router(trials.router)
app.include_router(workflow.router)
app.include_router(ai.router)
app.include_router(gantt.router)
app.include_router(knowledge.router)
app.include_router(schedule_events.router)
app.include_router(group_classes.router)
app.include_router(nag_router.router)
app.include_router(notify_router.router)
app.include_router(checklist.router)


@app.get("/health")
def health():
    return {"ok": True}
