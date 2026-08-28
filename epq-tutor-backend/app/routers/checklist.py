"""提交前检查清单模板 + 每届提交截止时间。

模板是**活定义**：学生只存打钩状态，模板一改所有学生立刻跟着变（任务书 D2）。
删项默认只是归档；「永久删除」才会清掉各学生身上的打钩数据（D2b）。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, submission
from app.auth import get_current_tutor
from app.schemas import ChecklistTemplateSchema, RoundDeadlinesSchema

router = APIRouter(tags=["submission"])


@router.get("/api/checklist-template", response_model=ChecklistTemplateSchema)
def get_checklist_template(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    return ChecklistTemplateSchema(items=submission.get_template(db, tutor))


@router.put("/api/checklist-template", response_model=ChecklistTemplateSchema)
def save_checklist_template(
    data: ChecklistTemplateSchema,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    ids = [i.id for i in data.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="Duplicate checklist item id")
    tutor.submission_checklist_template = [i.model_dump() for i in data.items]
    db.commit()
    return ChecklistTemplateSchema(items=submission.get_template(db, tutor))


@router.delete("/api/checklist-template/{item_id}", response_model=ChecklistTemplateSchema)
def delete_checklist_item(
    item_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """永久删除：模板去项 + 清掉所有学生身上该项的打钩数据。"""
    items = [i for i in (tutor.submission_checklist_template or []) if i.get("id") != item_id]
    tutor.submission_checklist_template = items

    for student in db.query(models.Student).filter(models.Student.tutor_id == tutor.id).all():
        data = submission.normalize_checklist(student.submission_checklist)
        if item_id in data["ticked"]:
            data["ticked"].pop(item_id)
            student.submission_checklist = data

    db.commit()
    return ChecklistTemplateSchema(items=submission.get_template(db, tutor))


@router.get("/api/rounds/{name}/deadlines", response_model=RoundDeadlinesSchema)
def get_round_deadlines(
    name: str,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    r = db.query(models.Round).filter(models.Round.name == name).first()
    if r is None:
        return RoundDeadlinesSchema()
    return RoundDeadlinesSchema(normal=r.deadline_normal, extended=r.deadline_extended)


@router.put("/api/rounds/{name}/deadlines", response_model=RoundDeadlinesSchema)
def save_round_deadlines(
    name: str,
    data: RoundDeadlinesSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    r = db.query(models.Round).filter(models.Round.name == name).first()
    if r is None:
        r = models.Round(name=name)
        db.add(r)
    r.deadline_normal = data.normal or None
    r.deadline_extended = data.extended or None
    db.commit()
    return RoundDeadlinesSchema(normal=r.deadline_normal, extended=r.deadline_extended)
