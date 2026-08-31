from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import ScheduleEventSchema
from app.action_logger import log_action
import uuid

router = APIRouter(prefix="/api/schedule-events", tags=["schedule-events"])


def _to_schema(e: models.ScheduleEvent) -> ScheduleEventSchema:
    return ScheduleEventSchema(
        id=e.id,
        title=e.title or "",
        date=e.date,
        time=e.time,
        durationMinutes=e.duration_minutes if e.duration_minutes is not None else 60,
        note=e.note or "",
        link=e.link or "",
        countsAsOvertime=bool(e.counts_as_overtime),
        notify15Min=bool(e.notify_15min),
        createdAt=e.created_at.isoformat() if e.created_at else "",
        updatedAt=e.updated_at.isoformat() if e.updated_at else "",
    )


def _require_time(data: ScheduleEventSchema) -> None:
    # 无起始时间的会议不允许创建/保存——和 session/trial 全线对齐
    if not (data.time or "").strip():
        raise HTTPException(status_code=422, detail="起始时间必填——没有起始时间的会议不能创建")


@router.get("", response_model=list[ScheduleEventSchema])
def list_events(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    rows = db.query(models.ScheduleEvent).order_by(models.ScheduleEvent.date, models.ScheduleEvent.time).all()
    return [_to_schema(e) for e in rows]


@router.post("", response_model=ScheduleEventSchema)
def create_event(
    data: ScheduleEventSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    _require_time(data)
    event = models.ScheduleEvent(
        id=data.id or str(uuid.uuid4()),
        title=data.title,
        date=data.date,
        time=data.time,
        duration_minutes=data.durationMinutes,
        note=data.note,
        link=data.link,
        counts_as_overtime=bool(data.countsAsOvertime),
        notify_15min=bool(data.notify15Min),
    )
    db.add(event)
    log_action(db, "create", "schedule_event", event.id, {"title": data.title})
    db.commit()
    db.refresh(event)
    return _to_schema(event)


@router.put("/{event_id}", response_model=ScheduleEventSchema)
def update_event(
    event_id: str,
    data: ScheduleEventSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    _require_time(data)
    event = db.query(models.ScheduleEvent).filter(models.ScheduleEvent.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    event.title = data.title
    event.date = data.date
    event.time = data.time
    event.duration_minutes = data.durationMinutes
    event.note = data.note
    event.link = data.link
    event.counts_as_overtime = bool(data.countsAsOvertime)
    event.notify_15min = bool(data.notify15Min)
    log_action(db, "update", "schedule_event", event.id, {"title": data.title})
    db.commit()
    db.refresh(event)
    return _to_schema(event)


@router.delete("/{event_id}")
def delete_event(
    event_id: str,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    event = db.query(models.ScheduleEvent).filter(models.ScheduleEvent.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    log_action(db, "delete", "schedule_event", event_id)
    db.commit()
    return {"ok": True}
