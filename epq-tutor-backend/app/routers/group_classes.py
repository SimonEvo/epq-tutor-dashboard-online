from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import GroupClassSchema
from app.action_logger import log_action
import uuid

router = APIRouter(prefix="/api/group-classes", tags=["group-classes"])


def _to_schema(c: models.GroupClass) -> GroupClassSchema:
    return GroupClassSchema(
        id=c.id,
        title=c.title or "",
        date=c.date,
        time=c.time,
        durationMinutes=c.duration_minutes if c.duration_minutes is not None else 60,
        roster=c.roster or "",
        notify15Min=bool(c.notify_15min),
        note=c.note or "",
        link=c.link or "",
        createdAt=c.created_at.isoformat() if c.created_at else "",
        updatedAt=c.updated_at.isoformat() if c.updated_at else "",
    )


def _require_time(data: GroupClassSchema) -> None:
    # 无起始时间的安排不允许创建/保存——和 session / 试听 / 日程事件全线对齐
    if not (data.time or "").strip():
        raise HTTPException(status_code=422, detail="起始时间必填——没有起始时间的团课不能创建")


@router.get("", response_model=list[GroupClassSchema])
def list_group_classes(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    rows = db.query(models.GroupClass).order_by(models.GroupClass.date, models.GroupClass.time).all()
    return [_to_schema(c) for c in rows]


@router.post("", response_model=GroupClassSchema)
def create_group_class(
    data: GroupClassSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    _require_time(data)
    cls = models.GroupClass(
        id=data.id or str(uuid.uuid4()),
        title=data.title,
        date=data.date,
        time=data.time,
        duration_minutes=data.durationMinutes,
        roster=data.roster,
        notify_15min=bool(data.notify15Min),
        note=data.note,
        link=data.link,
    )
    db.add(cls)
    log_action(db, "create", "group_class", cls.id, {"title": data.title})
    db.commit()
    db.refresh(cls)
    return _to_schema(cls)


@router.put("/{class_id}", response_model=GroupClassSchema)
def update_group_class(
    class_id: str,
    data: GroupClassSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    _require_time(data)
    cls = db.query(models.GroupClass).filter(models.GroupClass.id == class_id).first()
    if cls is None:
        raise HTTPException(status_code=404, detail="Group class not found")
    cls.title = data.title
    cls.date = data.date
    cls.time = data.time
    cls.duration_minutes = data.durationMinutes
    cls.roster = data.roster
    cls.notify_15min = bool(data.notify15Min)
    cls.note = data.note
    cls.link = data.link
    log_action(db, "update", "group_class", cls.id, {"title": data.title})
    db.commit()
    db.refresh(cls)
    return _to_schema(cls)


@router.delete("/{class_id}")
def delete_group_class(
    class_id: str,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    cls = db.query(models.GroupClass).filter(models.GroupClass.id == class_id).first()
    if cls is None:
        raise HTTPException(status_code=404, detail="Group class not found")
    log_action(db, "delete", "group_class", cls.id, {"title": cls.title})
    db.delete(cls)
    db.commit()
    return {"ok": True}
