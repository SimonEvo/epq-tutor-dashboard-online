import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.routers import auth, students, supervisors, config, reports, calendar, backup as backup_router, zoom, trials, workflow, ai, gantt, knowledge, schedule_events, nag as nag_router
from app.database import engine, SessionLocal
from app import models, nag


# Check workflow scheduler this often. Inside the helper we still only create a
# new pending row when 14 days have passed, so this just controls timeliness.
SCHEDULER_CHECK_INTERVAL_SECONDS = 60 * 60 * 6  # every 6h
BACKUP_INTERVAL_SECONDS = 60 * 60 * 24  # every 24h
NAG_CHECK_INTERVAL_SECONDS = 60 * 10  # every 10min; fire once per workday 09:00 CN
NAG_HOUR = 9  # 北京时间每工作日触发的整点


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
    try:
        yield
    finally:
        task.cancel()
        backup_task.cancel()
        nag_task.cancel()


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
app.include_router(nag_router.router)


@app.get("/health")
def health():
    return {"ok": True}
