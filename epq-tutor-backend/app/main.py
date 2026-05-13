from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.routers import auth, students, supervisors, config, reports, calendar, backup
from app.database import engine
from app import models


@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(engine)
    # Safe column migrations — no-op if column already exists
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE students ADD COLUMN topic_zh TEXT DEFAULT ''"))
            conn.commit()
        except Exception:
            pass
    yield


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


@app.get("/health")
def health():
    return {"ok": True}
