from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from datetime import datetime, timezone
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import StudentSchema, StudentSummarySchema, SessionSummarySchema
from app.action_logger import log_action

router = APIRouter(prefix="/api/students", tags=["students"])


def _milestones_dict(rows: list[models.StudentMilestone]) -> dict:
    return {m.milestone_id: m.status for m in rows}


def _tags_list(tags: list[models.Tag]) -> list[str]:
    return [t.name for t in tags]


def _session_to_dict(s: models.Session) -> dict:
    return {
        "id": s.id, "type": s.type, "date": s.date, "time": s.time,
        "durationMinutes": s.duration_minutes, "title": s.title,
        "summary": s.summary or "", "homework": s.homework or "",
        "transcript": s.transcript or "", "privateNotes": s.private_notes or "",
        "createdAt": s.created_at.isoformat() if s.created_at else "",
        "generatedReport": s.generated_report,
        "reportGeneratedAt": s.report_generated_at,
        "zoomMeetingId": s.zoom_meeting_id,
        "zoomJoinUrl": s.zoom_join_url,
        "zoomPassword": s.zoom_password,
    }


def _entry_to_dict(e: models.PersonalEntry) -> dict:
    return {"id": e.id, "date": e.date, "title": e.title, "content": e.content, "createdAt": e.created_at}


def _mindmap_to_dict(m: models.MindMap) -> dict:
    return {"id": m.id, "date": m.date, "title": m.title, "content": m.content, "createdAt": m.created_at}


def _homework_to_dict(h: models.HomeworkEntry) -> dict:
    return {
        "id": h.id, "date": h.date, "sourceLabel": h.source_label,
        "sessionId": h.session_id, "deadline": h.deadline,
        "items": h.items or [], "comments": h.comments or "",
        "createdAt": h.created_at,
    }


def _to_full_schema(s: models.Student) -> StudentSchema:
    sorted_sessions = sorted(s.sessions, key=lambda x: x.date)
    return StudentSchema(
        id=s.id, name=s.name, nameEn=s.name_en, gender=s.gender,
        school=s.school, submissionRound=s.submission_round,
        taughtElementType=s.taught_element_type, universityAspiration=s.university_aspiration,
        currentGrade=s.current_grade, universityEnrollment=s.university_enrollment,
        contact=s.contact, supervisorId=s.supervisor_id,
        topic=s.topic or "", topicZh=s.topic_zh or "", overview=s.overview,
        saHoursTotal=s.sa_hours_total, saHoursUsed=s.sa_hours_used,
        nextSaSession=s.next_sa_session, nextTaSession=s.next_ta_session,
        nextTheorySession=s.next_theory_session,
        availabilityNote=s.availability_note or "", briefNote=s.brief_note or "",
        privateNotes=s.private_notes or "", tencentDocUrl=s.tencent_doc_url,
        scheduleEntries=s.schedule_entries or [],
        milestones=_milestones_dict(s.milestones),
        tags=_tags_list(s.tags),
        sessions=[_session_to_dict(x) for x in sorted_sessions],
        personalEntries=[_entry_to_dict(e) for e in s.personal_entries],
        mindMaps=[_mindmap_to_dict(m) for m in s.mind_maps],
        homeworkEntries=[_homework_to_dict(h) for h in s.homework_entries],
        generatedProgressReport=s.generated_progress_report,
        progressReportGeneratedAt=s.progress_report_generated_at,
        createdAt=s.created_at.isoformat() if s.created_at else "",
        updatedAt=s.updated_at.isoformat() if s.updated_at else "",
    )


def _to_summary(s: models.Student) -> StudentSummarySchema:
    past = [x for x in s.sessions if x.date <= datetime.now(timezone.utc).strftime("%Y-%m-%d")]
    last = max(past, key=lambda x: x.date, default=None) if past else None
    latest_hw = max(s.homework_entries, key=lambda h: h.date, default=None) if s.homework_entries else None
    return StudentSummarySchema(
        id=s.id, name=s.name, topic=s.topic or "", topicZh=s.topic_zh or "",
        tags=_tags_list(s.tags),
        saHoursTotal=s.sa_hours_total, saHoursUsed=s.sa_hours_used,
        nextSaSession=s.next_sa_session, nextTaSession=s.next_ta_session,
        nextTheorySession=s.next_theory_session,
        submissionRound=s.submission_round, supervisorId=s.supervisor_id,
        nameEn=s.name_en, overview=s.overview,
        sessions=[SessionSummarySchema(id=x.id, type=x.type, date=x.date, time=x.time, durationMinutes=x.duration_minutes) for x in s.sessions],
        availabilityNote=s.availability_note or "", briefNote=s.brief_note or "",
        latestScheduleEntry=(s.schedule_entries or [None])[0],
        lastSessionDate=last.date if last else None,
        lastSessionType=last.type if last else None,
        milestones=_milestones_dict(s.milestones),
        updatedAt=s.updated_at.isoformat() if s.updated_at else "",
        latestHomeworkEntry=_homework_to_dict(latest_hw) if latest_hw else None,
    )


def _load_student(db: Session, student_id: str, tutor_id: str) -> models.Student:
    s = (
        db.query(models.Student)
        .options(
            selectinload(models.Student.sessions),
            selectinload(models.Student.milestones),
            selectinload(models.Student.tags),
            selectinload(models.Student.personal_entries),
            selectinload(models.Student.mind_maps),
            selectinload(models.Student.homework_entries),
        )
        .filter(models.Student.id == student_id, models.Student.tutor_id == tutor_id)
        .first()
    )
    if s is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return s


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[StudentSummarySchema])
def list_students(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    students = (
        db.query(models.Student)
        .options(
            selectinload(models.Student.sessions),
            selectinload(models.Student.milestones),
            selectinload(models.Student.tags),
            selectinload(models.Student.homework_entries),
        )
        .filter(models.Student.tutor_id == tutor.id)
        .all()
    )
    archived_rounds = {r.name for r in db.query(models.Round).filter(models.Round.is_archived == True).all()}
    return [_to_summary(s) for s in students if s.submission_round not in archived_rounds]


@router.get("/{student_id}", response_model=StudentSchema)
def get_student(
    student_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    return _to_full_schema(_load_student(db, student_id, tutor.id))


@router.post("", response_model=StudentSchema)
def create_student(
    data: StudentSchema,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    return _upsert_student(db, tutor, data, is_new=True)


@router.put("/{student_id}", response_model=StudentSchema)
def save_student(
    student_id: str,
    data: StudentSchema,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    if data.id != student_id:
        raise HTTPException(status_code=400, detail="ID mismatch")
    existing = db.query(models.Student).filter(models.Student.id == student_id).first()
    return _upsert_student(db, tutor, data, is_new=existing is None)


def _upsert_student(
    db: Session, tutor: models.Tutor, data: StudentSchema, is_new: bool
) -> StudentSchema:
    s = db.query(models.Student).filter(models.Student.id == data.id).first() if not is_new else None

    # Capture old state for diff-based action logging
    old_session_ids: set[str] = set()
    old_session_reports: dict[str, str | None] = {}
    old_milestones: dict[str, str] = {}
    old_homework_ids: set[str] = set()
    old_personal_ids: set[str] = set()
    old_mindmap_ids: set[str] = set()
    old_progress_report: str | None = None
    if s is not None:
        old_session_ids = {x.id for x in s.sessions}
        old_session_reports = {x.id: x.generated_report for x in s.sessions}
        old_milestones = {m.milestone_id: m.status for m in s.milestones}
        old_homework_ids = {h.id for h in s.homework_entries}
        old_personal_ids = {p.id for p in s.personal_entries}
        old_mindmap_ids = {m.id for m in s.mind_maps}
        old_progress_report = s.generated_progress_report

    # AI generation detection: progress report newly set or changed
    if data.generatedProgressReport and data.generatedProgressReport != old_progress_report:
        log_action(db, "ai_generate", "progress_report", data.id, {"studentId": data.id})

    # AI generation detection: any session report newly set or changed
    for sd in (data.sessions or []):
        if sd.generatedReport and sd.generatedReport != old_session_reports.get(sd.id):
            log_action(db, "ai_generate", "session_report", sd.id,
                       {"sessionId": sd.id, "studentId": data.id})

    if s is None:
        s = models.Student(id=data.id, tutor_id=tutor.id)
        db.add(s)
        log_action(db, "create", "student", data.id, {"name": data.name})
    else:
        log_action(db, "update", "student", data.id)

    s.name = data.name; s.name_en = data.nameEn; s.gender = data.gender
    s.school = data.school; s.submission_round = data.submissionRound
    s.taught_element_type = data.taughtElementType
    s.university_aspiration = data.universityAspiration
    s.current_grade = data.currentGrade; s.university_enrollment = data.universityEnrollment
    s.contact = data.contact; s.supervisor_id = data.supervisorId
    s.topic = data.topic; s.topic_zh = data.topicZh; s.overview = data.overview
    s.sa_hours_total = data.saHoursTotal; s.sa_hours_used = data.saHoursUsed
    s.next_sa_session = data.nextSaSession; s.next_ta_session = data.nextTaSession
    s.next_theory_session = data.nextTheorySession
    s.availability_note = data.availabilityNote; s.brief_note = data.briefNote
    s.schedule_entries = data.scheduleEntries or []
    s.private_notes = data.privateNotes; s.tencent_doc_url = data.tencentDocUrl
    s.generated_progress_report = data.generatedProgressReport
    s.progress_report_generated_at = data.progressReportGeneratedAt
    s.updated_at = datetime.now(timezone.utc)

    # sessions
    new_session_ids = {sd.id for sd in (data.sessions or [])}
    for added in new_session_ids - old_session_ids:
        sd = next((x for x in data.sessions if x.id == added), None)
        log_action(db, "create", "session", added,
                   {"type": sd.type, "studentId": s.id} if sd else {"studentId": s.id})
    for removed in old_session_ids - new_session_ids:
        log_action(db, "delete", "session", removed, {"studentId": s.id})

    db.query(models.Session).filter(models.Session.student_id == s.id).delete()
    for sd in (data.sessions or []):
        db.add(models.Session(
            id=sd.id, student_id=s.id, type=sd.type, date=sd.date,
            time=sd.time, duration_minutes=sd.durationMinutes, title=sd.title,
            summary=sd.summary, homework=sd.homework, transcript=sd.transcript,
            private_notes=sd.privateNotes, generated_report=sd.generatedReport,
            report_generated_at=sd.reportGeneratedAt,
            zoom_meeting_id=sd.zoomMeetingId, zoom_join_url=sd.zoomJoinUrl, zoom_password=sd.zoomPassword,
            created_at=datetime.fromisoformat(sd.createdAt) if sd.createdAt else datetime.now(timezone.utc),
        ))

    # milestones — log status transitions
    for mid, new_status in (data.milestones or {}).items():
        old_status = old_milestones.get(mid)
        if old_status != new_status:
            log_action(db, "update", "milestone", mid,
                       {"studentId": s.id, "from": old_status or "none", "to": new_status})

    db.query(models.StudentMilestone).filter(models.StudentMilestone.student_id == s.id).delete()
    for mid, status in (data.milestones or {}).items():
        db.add(models.StudentMilestone(student_id=s.id, milestone_id=mid, status=status))

    # tags
    s.tags.clear()
    for tag_name in (data.tags or []):
        tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
        if tag is None:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        s.tags.append(tag)

    # personal entries
    new_personal_ids = {e["id"] for e in (data.personalEntries or [])}
    for added in new_personal_ids - old_personal_ids:
        log_action(db, "create", "personal_entry", added, {"studentId": s.id})
    for removed in old_personal_ids - new_personal_ids:
        log_action(db, "delete", "personal_entry", removed, {"studentId": s.id})

    db.query(models.PersonalEntry).filter(models.PersonalEntry.student_id == s.id).delete()
    for e in (data.personalEntries or []):
        db.add(models.PersonalEntry(
            id=e["id"], student_id=s.id, date=e["date"],
            title=e["title"], content=e["content"], created_at=e["createdAt"],
        ))

    # mind maps
    new_mindmap_ids = {m["id"] for m in (data.mindMaps or [])}
    for added in new_mindmap_ids - old_mindmap_ids:
        log_action(db, "create", "mind_map", added, {"studentId": s.id})
    for removed in old_mindmap_ids - new_mindmap_ids:
        log_action(db, "delete", "mind_map", removed, {"studentId": s.id})

    db.query(models.MindMap).filter(models.MindMap.student_id == s.id).delete()
    for m in (data.mindMaps or []):
        db.add(models.MindMap(
            id=m["id"], student_id=s.id, date=m["date"],
            title=m["title"], content=m["content"], created_at=m["createdAt"],
        ))

    # homework entries
    new_homework_ids = {h["id"] for h in (data.homeworkEntries or [])}
    for added in new_homework_ids - old_homework_ids:
        log_action(db, "create", "homework", added, {"studentId": s.id})
    for removed in old_homework_ids - new_homework_ids:
        log_action(db, "delete", "homework", removed, {"studentId": s.id})

    db.query(models.HomeworkEntry).filter(models.HomeworkEntry.student_id == s.id).delete()
    for h in (data.homeworkEntries or []):
        db.add(models.HomeworkEntry(
            id=h["id"], student_id=s.id, session_id=h.get("sessionId"),
            date=h["date"], source_label=h["sourceLabel"],
            deadline=h.get("deadline"), items=h.get("items", []),
            comments=h.get("comments", ""), created_at=h["createdAt"],
        ))

    db.commit()
    return _to_full_schema(_load_student(db, s.id, tutor.id))


@router.patch("/{student_id}/homework/{entry_id}/item/{item_idx}")
def toggle_homework_item(
    student_id: str,
    entry_id: str,
    item_idx: int,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    # Verify ownership
    student = db.query(models.Student).filter(
        models.Student.id == student_id,
        models.Student.tutor_id == tutor.id,
    ).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    entry = db.query(models.HomeworkEntry).filter(
        models.HomeworkEntry.id == entry_id,
        models.HomeworkEntry.student_id == student_id,
    ).first()
    if entry is None:
        raise HTTPException(status_code=404, detail="Homework entry not found")

    items = list(entry.items or [])
    if item_idx < 0 or item_idx >= len(items):
        raise HTTPException(status_code=400, detail="Item index out of range")

    items[item_idx] = {**items[item_idx], "done": bool(body.get("done", False))}
    entry.items = items
    db.commit()
    return {"ok": True}
