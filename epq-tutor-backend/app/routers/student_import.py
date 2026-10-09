"""学生批量导入：预览 diff → 人工确认 → 应用。

对标教务系统的 bulk-sync-preview / bulk-sync-apply（见
../hr-management/backend/app/api/routes/projects.py）。表头识别和 Excel 解析在
前端做（utils/studentExcelParser.ts），这里只管匹配、算差异、落库。

## 三条规则

1. **空单元格不覆盖已有数据。** 导入表往往只含部分列；把空值当「清空」会在一次
   导入里静默抹掉纪要、备注这些表里根本没有的字段。只有非空值才进 diff。
2. **匹配靠姓名（归一后）。** 本系统没有学号也没有邮箱，姓名是唯一可用的身份。
   命中多条或批次内重名一律标 conflict 交人工判断，绝不自动合并。
3. **导入不碰关联数据。** 只写学生档案字段，不动 sessions / 里程碑 / 作业。
"""
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models, rounds
from app.action_logger import log_action
from app.auth import get_current_tutor
from app.database import get_db
from app.scoping import scoped

router = APIRouter(prefix="/api/students/import", tags=["student-import"])


class ImportStudent(BaseModel):
    name: str = ""
    nameEn: str | None = None
    gender: str | None = None
    school: str | None = None
    currentGrade: str | None = None
    contact: str | None = None
    registrationRound: str | None = None
    submissionRound: str | None = None
    isOneYear: bool = False
    universityAspiration: str | None = None
    taughtElementType: str | None = None
    universityEnrollment: str | None = None
    topic: str | None = None
    topicZh: str | None = None
    overview: str | None = None
    saHoursTotal: int | None = None
    supervisorName: str | None = None
    briefNote: str | None = None
    availabilityNote: str | None = None
    classBatch: str | None = None   # 仅用于解析一年期起始轮次，不入库


# 导入可写的字段：ImportStudent 属性名 -> Student 列名
FIELD_MAP = {
    "name": "name",
    "nameEn": "name_en",
    "gender": "gender",
    "school": "school",
    "currentGrade": "current_grade",
    "contact": "contact",
    "registrationRound": "registration_round",
    "submissionRound": "submission_round",
    "isOneYear": "is_one_year",
    "universityAspiration": "university_aspiration",
    "taughtElementType": "taught_element_type",
    "universityEnrollment": "university_enrollment",
    "topic": "topic",
    "topicZh": "topic_zh",
    "overview": "overview",
    "saHoursTotal": "sa_hours_total",
    "briefNote": "brief_note",
    "availabilityNote": "availability_note",
}

FIELD_LABEL = {
    "name": "姓名", "nameEn": "英文名", "gender": "性别", "school": "学校",
    "currentGrade": "年级", "contact": "联系方式",
    "registrationRound": "报名轮次", "submissionRound": "提交轮次",
    "isOneYear": "一年期", "universityAspiration": "大学方向",
    "taughtElementType": "授课类型", "universityEnrollment": "升学",
    "topic": "课题", "topicZh": "课题(中)", "overview": "概述",
    "saHoursTotal": "SA 总课时", "briefNote": "简报", "availabilityNote": "可用时间",
    "supervisorName": "督导",
}


class FieldDiff(BaseModel):
    field: str
    label: str
    before: str = ""
    after: str = ""


class PreviewRow(BaseModel):
    rowIndex: int
    category: str                 # new | update | conflict
    name: str
    reason: str = ""              # conflict 时说明原因
    matchedStudentId: str | None = None
    matchedStudentName: str | None = None
    diffs: list[FieldDiff] = []
    supervisorId: str | None = None
    supervisorWarning: str = ""
    data: ImportStudent


class PreviewRequest(BaseModel):
    rows: list[ImportStudent]


class PreviewResult(BaseModel):
    rows: list[PreviewRow]
    summary: dict


class ApplyRow(BaseModel):
    action: str                   # create | update | skip
    studentId: str | None = None
    data: ImportStudent


class ApplyRequest(BaseModel):
    rows: list[ApplyRow]


def _norm_name(v: str | None) -> str:
    """比对用的姓名：去掉空白、全角括号统一、一年期标记剥掉、英文小写。"""
    if not v:
        return ""
    s = rounds.strip_one_year_marker(v)
    s = re.sub(r"[\s　]+", "", s)
    return s.lower()


def _as_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "是" if v else "否"
    return str(v)


def _resolve_rounds(row: ImportStudent) -> ImportStudent:
    """把姓名/班期里的一年期标记解析出来，补齐两个轮次字段。"""
    name, reg, sub, one_year = rounds.resolve_import_rounds(
        name=row.name,
        registration_round=row.registrationRound,
        class_batch=row.classBatch,
    )
    merged = row.model_copy(update={
        "name": name or row.name,
        "registrationRound": reg,
        # 表里显式给了提交轮次就尊重它（可能是延期学生），否则用推导值
        "submissionRound": rounds.normalize_round(row.submissionRound) or sub,
        "isOneYear": one_year or row.isOneYear,
    })
    if merged.isOneYear and not row.submissionRound:
        merged.submissionRound = rounds.derive_submission_round(
            merged.registrationRound, True
        )
    return merged


def _supervisor_lookup(db: Session, tutor: models.Tutor) -> dict[str, list[models.Supervisor]]:
    out: dict[str, list[models.Supervisor]] = {}
    for sv in scoped(db, models.Supervisor, tutor).all():
        out.setdefault(_norm_name(sv.name), []).append(sv)
    return out


def _incoming_value(row: ImportStudent, attr: str):
    """空值一律返回 None —— 空单元格不参与写入（规则 1）。

    isOneYear 为 False 也当作「没提供」：导入只能打上一年期标记，不能取消。
    取消需要去编辑页手动改 —— 否则任何一张没有该列的表都会把标记洗掉。
    """
    v = getattr(row, attr, None)
    if attr == "isOneYear":
        return bool(v) if v else None
    if v is None:
        return None
    if isinstance(v, str) and not v.strip():
        return None
    return v


def _build_preview(db: Session, tutor: models.Tutor, raw_rows: list[ImportStudent]) -> PreviewResult:
    existing = scoped(db, models.Student, tutor).all()
    by_name: dict[str, list[models.Student]] = {}
    for s in existing:
        by_name.setdefault(_norm_name(s.name), []).append(s)

    sup_by_name = _supervisor_lookup(db, tutor)
    seen_in_batch: dict[str, int] = {}
    out: list[PreviewRow] = []

    for idx, raw in enumerate(raw_rows):
        row = _resolve_rounds(raw)
        key = _norm_name(row.name)

        sup_id, sup_warn = None, ""
        if row.supervisorName:
            matches = sup_by_name.get(_norm_name(row.supervisorName), [])
            if len(matches) == 1:
                sup_id = matches[0].id
            elif matches:
                sup_warn = f"督导「{row.supervisorName}」有多位同名，导入时留空"
            else:
                sup_warn = f"督导「{row.supervisorName}」不在名单中，导入时留空"

        if not key:
            out.append(PreviewRow(rowIndex=idx, category="conflict", name=row.name or "",
                                  reason="姓名为空", data=row))
            continue

        if key in seen_in_batch:
            out.append(PreviewRow(
                rowIndex=idx, category="conflict", name=row.name,
                reason=f"与本批次第 {seen_in_batch[key] + 1} 行姓名相同，请确认是否重复",
                data=row, supervisorId=sup_id, supervisorWarning=sup_warn))
            continue
        seen_in_batch[key] = idx

        matches = by_name.get(key, [])
        if len(matches) > 1:
            out.append(PreviewRow(
                rowIndex=idx, category="conflict", name=row.name,
                reason=f"系统里有 {len(matches)} 名同名学生，无法确定更新哪一个",
                data=row, supervisorId=sup_id, supervisorWarning=sup_warn))
            continue

        if not matches:
            out.append(PreviewRow(rowIndex=idx, category="new", name=row.name, data=row,
                                  supervisorId=sup_id, supervisorWarning=sup_warn))
            continue

        target = matches[0]
        diffs = []
        for attr, col in FIELD_MAP.items():
            incoming = _incoming_value(row, attr)
            if incoming is None:
                continue
            current = getattr(target, col)
            if attr in ("registrationRound", "submissionRound"):
                incoming = rounds.normalize_round(incoming)
            if _as_text(current) != _as_text(incoming):
                diffs.append(FieldDiff(field=attr, label=FIELD_LABEL.get(attr, attr),
                                       before=_as_text(current), after=_as_text(incoming)))
        if sup_id and sup_id != target.supervisor_id:
            diffs.append(FieldDiff(
                field="supervisorName",
                label=FIELD_LABEL["supervisorName"],
                before=_sup_name(db, tutor, target.supervisor_id),
                after=row.supervisorName or "",
            ))
        out.append(PreviewRow(
            rowIndex=idx, category="update", name=row.name,
            matchedStudentId=target.id, matchedStudentName=target.name,
            diffs=diffs, data=row, supervisorId=sup_id, supervisorWarning=sup_warn))

    summary = {
        "new": sum(1 for r in out if r.category == "new"),
        "update": sum(1 for r in out if r.category == "update"),
        "conflict": sum(1 for r in out if r.category == "conflict"),
        "unchanged": sum(1 for r in out if r.category == "update" and not r.diffs),
    }
    return PreviewResult(rows=out, summary=summary)


def _sup_name(db: Session, tutor: models.Tutor, sup_id: str | None) -> str:
    if not sup_id:
        return ""
    sv = scoped(db, models.Supervisor, tutor).filter(models.Supervisor.id == sup_id).first()
    return sv.name if sv else ""


@router.post("/preview", response_model=PreviewResult)
def preview_import(
    body: PreviewRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    return _build_preview(db, tutor, body.rows)


@router.post("/apply")
def apply_import(
    body: ApplyRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    sup_by_name = _supervisor_lookup(db, tutor)
    created = updated = skipped = 0

    for entry in body.rows:
        if entry.action == "skip":
            skipped += 1
            continue

        row = _resolve_rounds(entry.data)
        if not (row.name or "").strip():
            raise HTTPException(status_code=422, detail="姓名为空的行不能导入")

        if entry.action == "create":
            student = models.Student(id=str(uuid.uuid4()), tutor_id=tutor.id, name=row.name)
            db.add(student)
            created += 1
        elif entry.action == "update":
            student = (
                scoped(db, models.Student, tutor)
                .filter(models.Student.id == entry.studentId)
                .first()
            )
            if student is None:
                raise HTTPException(status_code=404, detail="要更新的学生不存在")
            updated += 1
        else:
            raise HTTPException(status_code=422, detail=f"未知操作 {entry.action}")

        for attr, col in FIELD_MAP.items():
            value = _incoming_value(row, attr)
            if value is None:
                continue
            if attr in ("registrationRound", "submissionRound"):
                value = rounds.normalize_round(value)
            setattr(student, col, value)

        if row.supervisorName:
            matches = sup_by_name.get(_norm_name(row.supervisorName), [])
            if len(matches) == 1:
                student.supervisor_id = matches[0].id

        log_action(db, tutor, entry.action, "student", student.id,
                   {"name": student.name, "via": "import"})

    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped}
