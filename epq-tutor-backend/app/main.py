import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.routers import auth, students, supervisors, config, reports, calendar, backup, zoom, trials, workflow, ai
from app.database import engine, SessionLocal
from app import models


# Check workflow scheduler this often. Inside the helper we still only create a
# new pending row when 14 days have passed, so this just controls timeliness.
SCHEDULER_CHECK_INTERVAL_SECONDS = 60 * 60 * 6  # every 6h


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
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="EPQ Tutor API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(backup.router)
app.include_router(zoom.router)
app.include_router(trials.router)
app.include_router(workflow.router)
app.include_router(ai.router)


@app.get("/health")
def health():
    return {"ok": True}
