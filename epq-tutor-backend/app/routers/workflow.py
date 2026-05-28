"""Routes for workflow analysis: action logs (read-only), manual logs (CRUD),
workflow analyses (list/get/update content). Scheduler lives in main.py."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import (
    ActionLogSchema, ManualLogSchema,
    WorkflowAnalysisSchema, WorkflowAnalysisUpdateSchema,
)
from app.action_logger import log_action
import uuid

router = APIRouter(prefix="/api/workflow", tags=["workflow"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _action_to_schema(a: models.ActionLog) -> ActionLogSchema:
    return ActionLogSchema(
        id=a.id,
        timestamp=a.timestamp.isoformat() if a.timestamp else "",
        action=a.action,
        entityType=a.entity_type,
        entityId=a.entity_id or "",
        metadata=a.action_metadata or {},
    )


def _manual_to_schema(m: models.ManualLog) -> ManualLogSchema:
    return ManualLogSchema(
        id=m.id,
        occurredAt=m.occurred_at.isoformat() if m.occurred_at else "",
        description=m.description,
        createdAt=m.created_at.isoformat() if m.created_at else "",
        updatedAt=m.updated_at.isoformat() if m.updated_at else "",
    )


def _analysis_to_schema(w: models.WorkflowAnalysis) -> WorkflowAnalysisSchema:
    return WorkflowAnalysisSchema(
        id=w.id,
        periodStart=w.period_start.isoformat() if w.period_start else "",
        periodEnd=w.period_end.isoformat() if w.period_end else "",
        status=w.status,
        content=w.content or "",
        generatedAt=w.generated_at.isoformat() if w.generated_at else None,
        createdAt=w.created_at.isoformat() if w.created_at else "",
    )


# ── Action logs (read-only) ──────────────────────────────────────────────────

@router.get("/action-logs", response_model=list[ActionLogSchema])
def list_action_logs(
    since: str | None = None,
    until: str | None = None,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    """Return action logs in the given window (ISO date or datetime, both inclusive)."""
    q = db.query(models.ActionLog)
    if since:
        q = q.filter(models.ActionLog.timestamp >= datetime.fromisoformat(since))
    if until:
        q = q.filter(models.ActionLog.timestamp <= datetime.fromisoformat(until))
    rows = q.order_by(models.ActionLog.timestamp.desc()).limit(5000).all()
    return [_action_to_schema(a) for a in rows]


# ── Manual logs (CRUD) ───────────────────────────────────────────────────────

@router.get("/manual-logs", response_model=list[ManualLogSchema])
def list_manual_logs(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    rows = db.query(models.ManualLog).order_by(models.ManualLog.occurred_at.desc()).all()
    return [_manual_to_schema(m) for m in rows]


@router.post("/manual-logs", response_model=ManualLogSchema)
def create_manual_log(
    data: ManualLogSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    m = models.ManualLog(
        id=data.id or str(uuid.uuid4()),
        occurred_at=datetime.fromisoformat(data.occurredAt),
        description=data.description,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _manual_to_schema(m)


@router.put("/manual-logs/{log_id}", response_model=ManualLogSchema)
def update_manual_log(
    log_id: str,
    data: ManualLogSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    m = db.query(models.ManualLog).filter(models.ManualLog.id == log_id).first()
    if m is None:
        raise HTTPException(status_code=404, detail="Manual log not found")
    m.occurred_at = datetime.fromisoformat(data.occurredAt)
    m.description = data.description
    db.commit()
    db.refresh(m)
    return _manual_to_schema(m)


@router.delete("/manual-logs/{log_id}")
def delete_manual_log(
    log_id: str,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    m = db.query(models.ManualLog).filter(models.ManualLog.id == log_id).first()
    if m is None:
        raise HTTPException(status_code=404, detail="Manual log not found")
    db.delete(m)
    db.commit()
    return {"ok": True}


# ── Workflow analyses ────────────────────────────────────────────────────────

@router.get("/analyses", response_model=list[WorkflowAnalysisSchema])
def list_analyses(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    rows = db.query(models.WorkflowAnalysis).order_by(models.WorkflowAnalysis.id.desc()).all()
    return [_analysis_to_schema(w) for w in rows]


@router.get("/analyses/pending", response_model=WorkflowAnalysisSchema | None)
def get_pending_analysis(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    """Return the latest pending analysis if one exists (waiting for client-side AI fill)."""
    row = (
        db.query(models.WorkflowAnalysis)
        .filter(models.WorkflowAnalysis.status == "pending")
        .order_by(models.WorkflowAnalysis.id.desc())
        .first()
    )
    if row is None:
        return None
    return _analysis_to_schema(row)


@router.put("/analyses/{analysis_id}", response_model=WorkflowAnalysisSchema)
def fill_analysis(
    analysis_id: int,
    data: WorkflowAnalysisUpdateSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    """Client-side AI fills in the content of a pending analysis."""
    row = db.query(models.WorkflowAnalysis).filter(models.WorkflowAnalysis.id == analysis_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    row.content = data.content
    row.status = "generated"
    row.generated_at = datetime.now(timezone.utc)
    log_action(db, "ai_generate", "workflow_analysis", str(analysis_id))
    db.commit()
    db.refresh(row)
    return _analysis_to_schema(row)


# ── Scheduler helper (called from main.py lifespan loop) ─────────────────────

ANALYSIS_PERIOD_DAYS = 14


def maybe_create_pending_analysis(db: Session) -> models.WorkflowAnalysis | None:
    """Create a new pending workflow analysis if 14+ days have passed since the
    most recent one. Idempotent: returns None if already pending or too recent."""
    latest = (
        db.query(models.WorkflowAnalysis)
        .order_by(models.WorkflowAnalysis.id.desc())
        .first()
    )
    now = datetime.now(timezone.utc)

    if latest is None:
        # First analysis ever — wait until we have at least 14 days of action data.
        first_action = db.query(models.ActionLog).order_by(models.ActionLog.timestamp.asc()).first()
        if first_action is None:
            return None
        first_ts = first_action.timestamp
        if first_ts.tzinfo is None:
            first_ts = first_ts.replace(tzinfo=timezone.utc)
        if (now - first_ts) < timedelta(days=ANALYSIS_PERIOD_DAYS):
            return None
        period_start = first_ts
        period_end = now
    else:
        if latest.status == "pending":
            return None  # already waiting on client-side AI

        latest_end = latest.period_end
        # Normalize naive datetimes to UTC for comparison
        if latest_end.tzinfo is None:
            latest_end = latest_end.replace(tzinfo=timezone.utc)

        if (now - latest_end) < timedelta(days=ANALYSIS_PERIOD_DAYS):
            return None  # too soon

        period_start = latest_end
        period_end = now

    row = models.WorkflowAnalysis(
        period_start=period_start,
        period_end=period_end,
        status="pending",
        content="",
        generated_at=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
