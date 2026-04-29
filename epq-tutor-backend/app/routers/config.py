from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import TagsConfig

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/tags", response_model=TagsConfig)
def get_tags(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    tags = db.query(models.Tag).order_by(models.Tag.name).all()
    return TagsConfig(tags=[t.name for t in tags])


@router.put("/tags", response_model=TagsConfig)
def save_tags(
    data: TagsConfig,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    existing = {t.name: t for t in db.query(models.Tag).all()}
    incoming = set(data.tags)

    # Add new tags
    for name in incoming - existing.keys():
        db.add(models.Tag(name=name))

    # Remove orphaned tags (not used by any student)
    for name in existing.keys() - incoming:
        tag = existing[name]
        if not tag.student_tags:
            db.delete(tag)

    db.commit()
    tags = db.query(models.Tag).order_by(models.Tag.name).all()
    return TagsConfig(tags=[t.name for t in tags])


@router.get("/rounds")
def get_rounds(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    stored = [r.name for r in db.query(models.Round).all()]
    from_students = [
        r[0] for r in db.query(models.Student.submission_round)
        .filter(models.Student.submission_round.isnot(None))
        .distinct().all()
    ]
    return sorted(set(stored) | set(from_students))


@router.put("/rounds")
def save_rounds(
    data: list[str],
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    db.query(models.Round).delete()
    for name in data:
        db.add(models.Round(name=name))
    db.commit()
    return data
