import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.routers import auth, students, supervisors, config, reports, calendar, backup as backup_router, zoom, trials, workflow, ai, gantt, knowledge, schedule_events, group_classes, nag as nag_router, notify as notify_router, checklist
from app.database import engine, SessionLocal
from app import models, nag, notify


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
                backup_router.run_backup(db)
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
                workflow.maybe_create_pending_analysis(db)
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
    sent_digest_on = None
    sent_leads: set[str] = set()
    while True:
        try:
            now = nag.datetime.now(nag.CN_TZ)
            db = SessionLocal()
            try:
                tutor = db.query(models.Tutor).first()
                cfg = notify.settings_of(tutor) if tutor else None
                if tutor and cfg and cfg["enabled"] and cfg["webhookUrl"]:
                    # 每日汇总：设定时间后 10 分钟内触发，今天只发一次。
                    # 用窗口而不是「≥ 设定时间」——否则下午才打开开关、或者傍晚重启，
                    # 都会立刻补推一条早上的汇总。
                    hhmm = notify.parse_hhmm(cfg["digestTime"])
                    if hhmm and sent_digest_on != now.date():
                        delta = (now.hour * 60 + now.minute) - (hhmm[0] * 60 + hhmm[1])
                        if 0 <= delta < NOTIFY_DIGEST_WINDOW_MINUTES:
                            notify.run_digest(db, tutor)
                            sent_digest_on = now.date()

                    # 课前 15 分钟
                    for key, content in notify.due_lead_reminders(db, now):
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
                    nag.run_nag(db)
                finally:
                    db.close()
                last_sent_date = today
        except Exception:
            pass  # 定时任务永不因异常中断
        await asyncio.sleep(NAG_CHECK_INTERVAL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(engine)
    # Safe column migrations — no-op if column already exists
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE students ADD COLUMN topic_zh TEXT DEFAULT ''",
            "ALTER TABLE sessions ADD COLUMN zoom_meeting_id VARCHAR(64)",
            "ALTER TABLE sessions ADD COLUMN zoom_join_url TEXT",
            "ALTER TABLE sessions ADD COLUMN zoom_password VARCHAR(64)",
            "ALTER TABLE trials ADD COLUMN linked_student_id VARCHAR(64)",
            "ALTER TABLE trials ADD COLUMN `time` VARCHAR(8)",
            "ALTER TABLE trials ADD COLUMN duration_minutes INT",
            "ALTER TABLE tutors ADD COLUMN default_round VARCHAR(64)",
            "ALTER TABLE rounds ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE students ADD COLUMN schedule_entries JSON",
            "ALTER TABLE students ADD COLUMN ai_alias VARCHAR(128)",
            "ALTER TABLE sessions ADD COLUMN report_extra_context TEXT",
            "ALTER TABLE sessions ADD COLUMN feedback_sent BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE sessions ADD COLUMN is_final_defense BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE tutors ADD COLUMN kb_context_sources JSON",
            "ALTER TABLE sessions ADD COLUMN tutor_attending BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE tutors ADD COLUMN submission_checklist_template JSON",
            "ALTER TABLE rounds ADD COLUMN deadline_normal VARCHAR(20)",
            "ALTER TABLE rounds ADD COLUMN deadline_extended VARCHAR(20)",
            "ALTER TABLE students ADD COLUMN submission_checklist JSON",
            "ALTER TABLE students ADD COLUMN tii_checks JSON",
            "ALTER TABLE students ADD COLUMN deadline_tier VARCHAR(16) DEFAULT 'normal'",
            "ALTER TABLE students ADD COLUMN deadline_override VARCHAR(20)",
            "ALTER TABLE students ADD COLUMN deadline_change_confirmed BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE students ADD COLUMN wrapped_up_at DATETIME",
            "ALTER TABLE students ADD COLUMN defense_confirmed BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE schedule_events ADD COLUMN counts_as_overtime BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE tutors ADD COLUMN notify_enabled BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE tutors ADD COLUMN notify_webhook_url VARCHAR(512)",
            "ALTER TABLE tutors ADD COLUMN notify_digest_mode VARCHAR(16) DEFAULT 'prev_evening'",
            "ALTER TABLE tutors ADD COLUMN notify_digest_time VARCHAR(8) DEFAULT '21:00'",
            "ALTER TABLE sessions ADD COLUMN notify_15min BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE trials ADD COLUMN notify_15min BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE schedule_events ADD COLUMN notify_15min BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE group_classes ADD COLUMN notify_15min BOOLEAN NOT NULL DEFAULT 0",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass

    # One-time data migrations (idempotent — no-op if already done)
    with engine.connect() as conn:
        for old, new in [("August 2026", "26春"), ("March 2026", "25秋")]:
            conn.execute(text("UPDATE rounds SET name = :new WHERE name = :old"), {"new": new, "old": old})
            conn.execute(text("UPDATE students SET submission_round = :new WHERE submission_round = :old"), {"new": new, "old": old})
        conn.commit()

    # Initial check at startup, then schedule recurring checks
    db = SessionLocal()
    try:
        workflow.maybe_create_pending_analysis(db)
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
