from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, selectinload
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
    archived = {r.name for r in db.query(models.Round).filter(models.Round.is_archived == True).all()}
    stored = [r.name for r in db.query(models.Round).filter(models.Round.is_archived == False).all()]
    from_students = [
        r[0] for r in db.query(models.Student.submission_round)
        .filter(models.Student.submission_round.isnot(None))
        .distinct().all()
        if r[0] not in archived
    ]
    return sorted(set(stored) | set(from_students))


@router.get("/rounds/archived")
def get_archived_rounds(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    archived = db.query(models.Round).filter(models.Round.is_archived == True).all()
    result = []
    for r in archived:
        students = (
            db.query(models.Student)
            .filter(models.Student.submission_round == r.name, models.Student.tutor_id == tutor.id)
            .all()
        )
        result.append({"name": r.name, "studentCount": len(students), "students": [{"id": s.id, "name": s.name, "nameEn": s.name_en} for s in students]})
    return result


@router.post("/rounds/{name}/archive")
def archive_round(
    name: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    r = db.query(models.Round).filter(models.Round.name == name).first()
    if r is None:
        r = models.Round(name=name)
        db.add(r)
    r.is_archived = True
    if tutor.default_round == name:
        tutor.default_round = None
    db.commit()
    return {"ok": True}


@router.post("/rounds/{name}/unarchive")
def unarchive_round(
    name: str,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    r = db.query(models.Round).filter(models.Round.name == name).first()
    if r is None:
        raise HTTPException(status_code=404, detail="Round not found")
    r.is_archived = False
    db.commit()
    return {"ok": True}


@router.get("/rounds/{name}/export")
def export_round(
    name: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    from app.routers.students import _to_full_schema  # avoid circular import at module level
    students = (
        db.query(models.Student)
        .options(
            selectinload(models.Student.sessions),
            selectinload(models.Student.milestones),
            selectinload(models.Student.tags),
            selectinload(models.Student.homework_entries),
            selectinload(models.Student.personal_entries),
            selectinload(models.Student.mind_maps),
        )
        .filter(models.Student.submission_round == name, models.Student.tutor_id == tutor.id)
        .all()
    )
    data = [_to_full_schema(s).model_dump() for s in students]
    return JSONResponse(content={"round": name, "students": data})


@router.get("/default-round")
def get_default_round(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    return {"defaultRound": tutor.default_round or ""}


@router.put("/default-round")
def set_default_round(
    data: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    tutor.default_round = data.get("defaultRound") or None
    db.commit()
    return {"defaultRound": tutor.default_round or ""}


@router.put("/rounds")
def save_rounds(
    data: list[str],
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    existing = {r.name: r for r in db.query(models.Round).all()}
    incoming = set(data)
    # Remove rounds not in incoming list (preserve archived rounds)
    for name, r in existing.items():
        if name not in incoming and not r.is_archived:
            db.delete(r)
    # Add new rounds
    for name in incoming:
        if name not in existing:
            db.add(models.Round(name=name))
    db.commit()
    return data
