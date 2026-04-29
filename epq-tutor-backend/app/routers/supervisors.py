from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import SupervisorSchema
import uuid

router = APIRouter(prefix="/api/supervisors", tags=["supervisors"])


def _to_schema(s: models.Supervisor) -> SupervisorSchema:
    return SupervisorSchema(
        id=s.id, name=s.name, gender=s.gender, education=s.education,
        background=s.background, direction=s.direction, notes=s.notes,
        saType=s.sa_type,
    )


@router.get("", response_model=list[SupervisorSchema])
def list_supervisors(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    return [_to_schema(s) for s in db.query(models.Supervisor).all()]


@router.put("/{supervisor_id}", response_model=SupervisorSchema)
def save_supervisor(
    supervisor_id: str,
    data: SupervisorSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    sv = db.query(models.Supervisor).filter(models.Supervisor.id == supervisor_id).first()
    if sv is None:
        sv = models.Supervisor(id=supervisor_id)
        db.add(sv)
    sv.name = data.name
    sv.gender = data.gender
    sv.education = data.education
    sv.background = data.background
    sv.direction = data.direction
    sv.notes = data.notes
    sv.sa_type = data.saType
    db.commit()
    db.refresh(sv)
    return _to_schema(sv)


@router.post("", response_model=SupervisorSchema)
def create_supervisor(
    data: SupervisorSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    sv = models.Supervisor(
        id=data.id or str(uuid.uuid4()),
        name=data.name, gender=data.gender, education=data.education,
        background=data.background, direction=data.direction,
        notes=data.notes, sa_type=data.saType,
    )
    db.add(sv)
    db.commit()
    db.refresh(sv)
    return _to_schema(sv)


@router.delete("/{supervisor_id}")
def delete_supervisor(
    supervisor_id: str,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    sv = db.query(models.Supervisor).filter(models.Supervisor.id == supervisor_id).first()
    if sv is None:
        raise HTTPException(status_code=404, detail="Supervisor not found")
    db.delete(sv)
    db.commit()
    return {"ok": True}
