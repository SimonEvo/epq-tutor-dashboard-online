from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, Optional
from app.database import get_db
from app import models
from app.auth import get_current_tutor
import uuid

router = APIRouter(prefix="/api/gantt", tags=["gantt"])


class GanttProjectSummary(BaseModel):
    ownerType: str
    ownerId: Optional[str]
    name: str


class GanttProjectDetail(BaseModel):
    ownerType: str
    ownerId: Optional[str]
    name: str
    data: Any


class GanttProjectUpsert(BaseModel):
    name: str
    data: Any


def _resolve_owner_id(owner_id_param: str, tutor: models.Tutor) -> Optional[str]:
    """'me' maps to None (tutor-owned project)."""
    if owner_id_param == "me":
        return None
    return owner_id_param


def _to_detail(p: models.GanttProject) -> GanttProjectDetail:
    return GanttProjectDetail(
        ownerType=p.owner_type,
        ownerId=p.owner_id,
        name=p.name,
        data=p.data or {},
    )


@router.get("/projects", response_model=list[GanttProjectSummary])
def list_projects(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    projects = db.query(models.GanttProject).filter(
        models.GanttProject.tutor_id == tutor.id
    ).all()
    return [
        GanttProjectSummary(ownerType=p.owner_type, ownerId=p.owner_id, name=p.name)
        for p in projects
    ]


@router.get("/projects/{owner_type}/{owner_id}", response_model=GanttProjectDetail)
def get_project(
    owner_type: str,
    owner_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    resolved = _resolve_owner_id(owner_id, tutor)
    project = db.query(models.GanttProject).filter(
        models.GanttProject.tutor_id == tutor.id,
        models.GanttProject.owner_type == owner_type,
        models.GanttProject.owner_id == resolved,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _to_detail(project)


@router.put("/projects/{owner_type}/{owner_id}", response_model=GanttProjectDetail)
def upsert_project(
    owner_type: str,
    owner_id: str,
    body: GanttProjectUpsert,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    resolved = _resolve_owner_id(owner_id, tutor)
    project = db.query(models.GanttProject).filter(
        models.GanttProject.tutor_id == tutor.id,
        models.GanttProject.owner_type == owner_type,
        models.GanttProject.owner_id == resolved,
    ).first()
    if project:
        project.name = body.name
        project.data = body.data
    else:
        project = models.GanttProject(
            id=str(uuid.uuid4()),
            tutor_id=tutor.id,
            owner_type=owner_type,
            owner_id=resolved,
            name=body.name,
            data=body.data,
        )
        db.add(project)
    db.commit()
    db.refresh(project)
    return _to_detail(project)


@router.delete("/projects/{owner_type}/{owner_id}", status_code=204)
def delete_project(
    owner_type: str,
    owner_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    resolved = _resolve_owner_id(owner_id, tutor)
    project = db.query(models.GanttProject).filter(
        models.GanttProject.tutor_id == tutor.id,
        models.GanttProject.owner_type == owner_type,
        models.GanttProject.owner_id == resolved,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
