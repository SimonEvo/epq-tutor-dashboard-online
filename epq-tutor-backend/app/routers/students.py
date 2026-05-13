from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from datetime import datetime, timezone
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import StudentSchema, StudentSummarySchema, SessionSummarySchema

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
    return StudentSummarySchema(
        id=s.id, name=s.name, topic=s.topic or "", topicZh=s.topic_zh or "",
        tags=_tags_list(s.tags),
        saHoursTotal=s.sa_hours_total, saHoursUsed=s.sa_hours_used,
        nextSaSession=s.next_sa_session, nextTaSession=s.next_ta_session,
        nextTheorySession=s.next_theory_session,
        submissionRound=s.submission_round, supervisorId=s.supervisor_id,
        nameEn=s.name_en, overview=s.overview,
        sessions=[SessionSummarySchema(id=x.id, type=x.type, date=x.date, durationMinutes=x.duration_minutes) for x in s.sessions],
        availabilityNote=s.availability_note or "", briefNote=s.brief_note or "",
        lastSessionDate=last.date if last else None,
        lastSessionType=last.type if last else None,
        milestones=_milestones_dict(s.milestones),
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
        )
        .filter(models.Student.tutor_id == tutor.id)
        .all()
    )
    return [_to_summary(s) for s in students]


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
    if s is None:
        s = models.Student(id=data.id, tutor_id=tutor.id)
        db.add(s)

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
    s.private_notes = data.privateNotes; s.tencent_doc_url = data.tencentDocUrl
    s.generated_progress_report = data.generatedProgressReport
    s.progress_report_generated_at = data.progressReportGeneratedAt
    s.updated_at = datetime.now(timezone.utc)

    # sessions
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

    # milestones
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
    db.query(models.PersonalEntry).filter(models.PersonalEntry.student_id == s.id).delete()
    for e in (data.personalEntries or []):
        db.add(models.PersonalEntry(
            id=e["id"], student_id=s.id, date=e["date"],
            title=e["title"], content=e["content"], created_at=e["createdAt"],
        ))

    # mind maps
    db.query(models.MindMap).filter(models.MindMap.student_id == s.id).delete()
    for m in (data.mindMaps or []):
        db.add(models.MindMap(
            id=m["id"], student_id=s.id, date=m["date"],
            title=m["title"], content=m["content"], created_at=m["createdAt"],
        ))

    # homework entries
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
