from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from datetime import datetime, timezone
from app.database import get_db
from app import models, rounds, resit
from app.auth import get_current_tutor
from app.scoping import scoped
from app.schemas import StudentSchema, StudentSummarySchema, SessionSummarySchema
from app.action_logger import log_action
from app import submission

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
        "reportExtraContext": s.report_extra_context,
        "feedbackSent": s.feedback_sent or False,
        "isFinalDefense": s.is_final_defense or False,
        "tutorAttending": s.tutor_attending or False,
        "notify15Min": s.notify_15min or False,
        "compTimeOvertime": s.comp_time_overtime or False,
        "attempt": s.attempt or 1,
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


def _submission_fields(s: models.Student, deadlines: dict) -> dict:
    return dict(
        submissionChecklist=submission.normalize_checklist(s.submission_checklist),
        tiiChecks=list(s.tii_checks or []),
        deadlineTier=s.deadline_tier or "normal",
        deadlineOverride=s.deadline_override,
        deadlineChangeConfirmed=bool(s.deadline_change_confirmed),
        effectiveDeadline=submission.effective_deadline(s, deadlines),
        deadlineNeedsConfirm=submission.deadline_needs_confirm_warning(s),
        wrappedUpAt=s.wrapped_up_at.isoformat() if s.wrapped_up_at else None,
        defenseConfirmed=bool(s.defense_confirmed),
        currentAttempt=resit.current_attempt(s),
        previousRounds=resit.previous_rounds(s),
    )


def _to_full_schema(s: models.Student, deadlines: dict | None = None) -> StudentSchema:
    sorted_sessions = sorted(s.sessions, key=lambda x: x.date)
    return StudentSchema(
        id=s.id, name=s.name, nameEn=s.name_en, gender=s.gender,
        school=s.school,
        registrationRound=s.registration_round,
        submissionRound=s.submission_round,
        isOneYear=bool(s.is_one_year),
        taughtElementType=s.taught_element_type, universityAspiration=s.university_aspiration,
        currentGrade=s.current_grade, universityEnrollment=s.university_enrollment,
        contact=s.contact, supervisorId=s.supervisor_id,
        topic=s.topic or "", topicZh=s.topic_zh or "", overview=s.overview,
        saHoursTotal=s.sa_hours_total, saHoursUsed=s.sa_hours_used,
        nextSaSession=s.next_sa_session, nextTaSession=s.next_ta_session,
        nextTheorySession=s.next_theory_session,
        availabilityNote=s.availability_note or "", briefNote=s.brief_note or "",
        privateNotes=s.private_notes or "", tencentDocUrl=s.tencent_doc_url, aiAlias=s.ai_alias,
        scheduleEntries=s.schedule_entries or [],
        milestones=_milestones_dict(s.milestones),
        tags=_tags_list(s.tags),
        sessions=[_session_to_dict(x) for x in sorted_sessions],
        personalEntries=[_entry_to_dict(e) for e in s.personal_entries],
        mindMaps=[_mindmap_to_dict(m) for m in s.mind_maps],
        homeworkEntries=[_homework_to_dict(h) for h in s.homework_entries],
        generatedProgressReport=s.generated_progress_report,
        progressReportGeneratedAt=s.progress_report_generated_at,
        previousAttempts=list(s.previous_attempts or []),
        createdAt=s.created_at.isoformat() if s.created_at else "",
        updatedAt=s.updated_at.isoformat() if s.updated_at else "",
        **_submission_fields(s, deadlines or {}),
    )


def _to_summary(s: models.Student, deadlines: dict | None = None) -> StudentSummarySchema:
    past = [x for x in s.sessions if x.date <= datetime.now(timezone.utc).strftime("%Y-%m-%d")]
    last = max(past, key=lambda x: x.date, default=None) if past else None
    latest_hw = max(s.homework_entries, key=lambda h: h.date, default=None) if s.homework_entries else None
    return StudentSummarySchema(
        id=s.id, name=s.name, topic=s.topic or "", topicZh=s.topic_zh or "",
        tags=_tags_list(s.tags),
        saHoursTotal=s.sa_hours_total, saHoursUsed=s.sa_hours_used,
        nextSaSession=s.next_sa_session, nextTaSession=s.next_ta_session,
        nextTheorySession=s.next_theory_session,
        registrationRound=s.registration_round,
        submissionRound=s.submission_round,
        isOneYear=bool(s.is_one_year),
        supervisorId=s.supervisor_id,
        nameEn=s.name_en, overview=s.overview,
        sessions=[SessionSummarySchema(id=x.id, type=x.type, date=x.date, time=x.time, durationMinutes=x.duration_minutes, feedbackSent=x.feedback_sent or False, isFinalDefense=x.is_final_defense or False, tutorAttending=x.tutor_attending or False, notify15Min=x.notify_15min or False, compTimeOvertime=x.comp_time_overtime or False, attempt=x.attempt or 1) for x in s.sessions],
        availabilityNote=s.availability_note or "", briefNote=s.brief_note or "",
        latestScheduleEntry=(s.schedule_entries or [None])[0],
        lastSessionDate=last.date if last else None,
        lastSessionType=last.type if last else None,
        milestones=_milestones_dict(s.milestones),
        updatedAt=s.updated_at.isoformat() if s.updated_at else "",
        latestHomeworkEntry=_homework_to_dict(latest_hw) if latest_hw else None,
        aiAlias=s.ai_alias,
        **_submission_fields(s, deadlines or {}),
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
    deadlines = submission.round_deadlines(db)
    return [_to_summary(s, deadlines) for s in students if s.submission_round not in archived_rounds]


@router.get("/{student_id}", response_model=StudentSchema)
def get_student(
    student_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    return _to_full_schema(_load_student(db, student_id, tutor.id), submission.round_deadlines(db))


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
    # 必须带 tutor 过滤：否则用别人的学生 id 发 PUT 会覆写别人的记录
    existing = scoped(db, models.Student, tutor).filter(models.Student.id == student_id).first()
    return _upsert_student(db, tutor, data, is_new=existing is None)


def _checked_supervisor_id(
    db: Session, tutor: models.Tutor, supervisor_id: str | None
) -> str | None:
    """校验督导属于同一租户。

    不校验的话，这里就是一条跨租户读取的旁路：把别人的 supervisor_id 写进自己的
    学生，学生详情页就会把别人的督导档案（含 notes 私人评价）渲染出来。
    """
    if not supervisor_id:
        return None
    exists = (
        scoped(db, models.Supervisor, tutor)
        .filter(models.Supervisor.id == supervisor_id)
        .first()
    )
    if exists is None:
        raise HTTPException(status_code=422, detail="督导不存在")
    return supervisor_id


def _upsert_student(
    db: Session, tutor: models.Tutor, data: StudentSchema, is_new: bool
) -> StudentSchema:
    s = (
        scoped(db, models.Student, tutor).filter(models.Student.id == data.id).first()
        if not is_new
        else None
    )
    if is_new and db.query(models.Student.id).filter(models.Student.id == data.id).first():
        # 该 id 存在，但不属于本租户（否则上面就查到了，is_new 也不会为真）。
        # 不加这一层就会走到 INSERT，撞主键炸成 500；对调用方而言它就是「不存在」。
        raise HTTPException(status_code=404, detail="学生不存在")

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
        log_action(db, tutor, "ai_generate", "progress_report", data.id, {"studentId": data.id})

    # AI generation detection: any session report newly set or changed
    for sd in (data.sessions or []):
        if sd.generatedReport and sd.generatedReport != old_session_reports.get(sd.id):
            log_action(db, tutor, "ai_generate", "session_report", sd.id,
                       {"sessionId": sd.id, "studentId": data.id})

    if s is None:
        s = models.Student(id=data.id, tutor_id=tutor.id)
        db.add(s)
        log_action(db, tutor, "create", "student", data.id, {"name": data.name})
    else:
        log_action(db, tutor, "update", "student", data.id)

    s.name = data.name; s.name_en = data.nameEn; s.gender = data.gender
    s.school = data.school
    # 换届 = 上一届的 ddl 安排作废（任务书 D11 / §5）
    # 归一轮次标签 + 换轮次时清掉旧截止安排（ADR 0003）
    submission.set_submission_round(s, data.submissionRound)
    s.registration_round = rounds.normalize_round(data.registrationRound)
    s.is_one_year = bool(data.isOneYear)
    s.taught_element_type = data.taughtElementType
    s.university_aspiration = data.universityAspiration
    s.current_grade = data.currentGrade; s.university_enrollment = data.universityEnrollment
    s.contact = data.contact
    s.supervisor_id = _checked_supervisor_id(db, tutor, data.supervisorId)
    s.topic = data.topic; s.topic_zh = data.topicZh; s.overview = data.overview
    s.sa_hours_total = data.saHoursTotal
    s.next_sa_session = data.nextSaSession; s.next_ta_session = data.nextTaSession
    s.next_theory_session = data.nextTheorySession
    s.availability_note = data.availabilityNote; s.brief_note = data.briefNote
    s.schedule_entries = data.scheduleEntries or []
    s.private_notes = data.privateNotes; s.tencent_doc_url = data.tencentDocUrl
    if data.aiAlias is not None:
        s.ai_alias = data.aiAlias
    s.generated_progress_report = data.generatedProgressReport
    s.progress_report_generated_at = data.progressReportGeneratedAt
    s.updated_at = datetime.now(timezone.utc)

    # sessions
    new_session_ids = {sd.id for sd in (data.sessions or [])}
    for added in new_session_ids - old_session_ids:
        sd = next((x for x in data.sessions if x.id == added), None)
        log_action(db, tutor, "create", "session", added,
                   {"type": sd.type, "studentId": s.id} if sd else {"studentId": s.id})
    for removed in old_session_ids - new_session_ids:
        log_action(db, tutor, "delete", "session", removed, {"studentId": s.id})

    db.query(models.Session).filter(models.Session.student_id == s.id).delete()
    attempt_now = resit.current_attempt(s)
    new_sessions = []
    for sd in (data.sessions or []):
        new_sessions.append(models.Session(
            id=sd.id, student_id=s.id, type=sd.type, date=sd.date,
            time=sd.time, duration_minutes=sd.durationMinutes, title=sd.title,
            summary=sd.summary, homework=sd.homework, transcript=sd.transcript,
            private_notes=sd.privateNotes, generated_report=sd.generatedReport,
            report_generated_at=sd.reportGeneratedAt,
            report_extra_context=sd.reportExtraContext,
            feedback_sent=sd.feedbackSent or False,
            is_final_defense=sd.isFinalDefense or False,
            tutor_attending=sd.tutorAttending or False,
            notify_15min=sd.notify15Min or False,
            comp_time_overtime=sd.compTimeOvertime or False,
            # 没带 attempt 的是新建的课 → 归到当前这次提交；越界的值收回到合法范围
            attempt=min(max(sd.attempt or attempt_now, 1), attempt_now),
            zoom_meeting_id=sd.zoomMeetingId, zoom_join_url=sd.zoomJoinUrl, zoom_password=sd.zoomPassword,
            created_at=datetime.fromisoformat(sd.createdAt) if sd.createdAt else datetime.now(timezone.utc),
        ))
    db.add_all(new_sessions)
    # 服务端按当前这次提交重算，不信前端传来的值 —— 前端各个建课入口
    # 都是数全部 SA 课，resit 之后会把第一次的课也算进来
    s.sa_hours_used = resit.sa_hours_used(s, new_sessions)

    # milestones — log status transitions
    for mid, new_status in (data.milestones or {}).items():
        old_status = old_milestones.get(mid)
        if old_status != new_status:
            log_action(db, tutor, "update", "milestone", mid,
                       {"studentId": s.id, "from": old_status or "none", "to": new_status})

    db.query(models.StudentMilestone).filter(models.StudentMilestone.student_id == s.id).delete()
    for mid, status in (data.milestones or {}).items():
        db.add(models.StudentMilestone(student_id=s.id, milestone_id=mid, status=status))

    # tags
    s.tags.clear()
    for tag_name in (data.tags or []):
        tag = scoped(db, models.Tag, tutor).filter(models.Tag.name == tag_name).first()
        if tag is None:
            tag = models.Tag(name=tag_name, tutor_id=tutor.id)
            db.add(tag)
            db.flush()
        s.tags.append(tag)

    # personal entries
    new_personal_ids = {e["id"] for e in (data.personalEntries or [])}
    for added in new_personal_ids - old_personal_ids:
        log_action(db, tutor, "create", "personal_entry", added, {"studentId": s.id})
    for removed in old_personal_ids - new_personal_ids:
        log_action(db, tutor, "delete", "personal_entry", removed, {"studentId": s.id})

    db.query(models.PersonalEntry).filter(models.PersonalEntry.student_id == s.id).delete()
    for e in (data.personalEntries or []):
        db.add(models.PersonalEntry(
            id=e["id"], student_id=s.id, date=e["date"],
            title=e["title"], content=e["content"], created_at=e["createdAt"],
        ))

    # mind maps
    new_mindmap_ids = {m["id"] for m in (data.mindMaps or [])}
    for added in new_mindmap_ids - old_mindmap_ids:
        log_action(db, tutor, "create", "mind_map", added, {"studentId": s.id})
    for removed in old_mindmap_ids - new_mindmap_ids:
        log_action(db, tutor, "delete", "mind_map", removed, {"studentId": s.id})

    db.query(models.MindMap).filter(models.MindMap.student_id == s.id).delete()
    for m in (data.mindMaps or []):
        db.add(models.MindMap(
            id=m["id"], student_id=s.id, date=m["date"],
            title=m["title"], content=m["content"], created_at=m["createdAt"],
        ))

    # homework entries
    new_homework_ids = {h["id"] for h in (data.homeworkEntries or [])}
    for added in new_homework_ids - old_homework_ids:
        log_action(db, tutor, "create", "homework", added, {"studentId": s.id})
    for removed in old_homework_ids - new_homework_ids:
        log_action(db, tutor, "delete", "homework", removed, {"studentId": s.id})

    db.query(models.HomeworkEntry).filter(models.HomeworkEntry.student_id == s.id).delete()
    for h in (data.homeworkEntries or []):
        db.add(models.HomeworkEntry(
            id=h["id"], student_id=s.id, session_id=h.get("sessionId"),
            date=h["date"], source_label=h["sourceLabel"],
            deadline=h.get("deadline"), items=h.get("items", []),
            comments=h.get("comments", ""), created_at=h["createdAt"],
        ))

    db.commit()
    return _to_full_schema(_load_student(db, s.id, tutor.id), submission.round_deadlines(db))


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


@router.patch("/{student_id}/ai_alias")
def patch_ai_alias(
    student_id: str,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """Update only the ai_alias field — never touches sessions or any other data."""
    student = db.query(models.Student).filter(
        models.Student.id == student_id,
        models.Student.tutor_id == tutor.id,
    ).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")
    student.ai_alias = body.get("aiAlias")
    db.commit()
    return {"ok": True}


# ── 提交（窄端点：只写自己那一列，绝不触碰 sessions 等关联表）─────────────────

def _own_student(db: Session, student_id: str, tutor_id: str) -> models.Student:
    student = db.query(models.Student).filter(
        models.Student.id == student_id,
        models.Student.tutor_id == tutor_id,
    ).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@router.patch("/{student_id}/checklist")
def patch_checklist(
    student_id: str,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """{itemId, checked} 切模板项打钩，或 {customItems:[...]} 全量替换额外项。"""
    student = _own_student(db, student_id, tutor.id)
    data = submission.normalize_checklist(student.submission_checklist)

    if "itemId" in body:
        item_id = str(body["itemId"])
        if body.get("checked"):
            data["ticked"][item_id] = datetime.now(timezone.utc).isoformat()
        else:
            data["ticked"].pop(item_id, None)

    if "customItems" in body:
        # 固定项不可删：服务端补回来
        data["customItems"] = submission.ensure_fixed_items(list(body.get("customItems") or []))

    student.submission_checklist = data
    db.commit()
    return {"ok": True, "submissionChecklist": data}


@router.patch("/{student_id}/deadline")
def patch_deadline(
    student_id: str,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """{tier?, override?, confirmed?}。改 tier/override 一律把运营确认重置为 false（D4）。"""
    student = _own_student(db, student_id, tutor.id)
    changed_deadline = False

    if "tier" in body:
        tier = body.get("tier") or "normal"
        if tier not in ("normal", "extended"):
            raise HTTPException(status_code=400, detail="Invalid deadline tier")
        if tier != (student.deadline_tier or "normal"):
            student.deadline_tier = tier
            changed_deadline = True

    if "override" in body:
        override = body.get("override") or None
        if override != student.deadline_override:
            student.deadline_override = override
            changed_deadline = True

    if changed_deadline:
        student.deadline_change_confirmed = False
    elif "confirmed" in body:
        student.deadline_change_confirmed = bool(body.get("confirmed"))

    db.commit()
    deadlines = submission.round_deadlines(db)
    return {
        "ok": True,
        "deadlineTier": student.deadline_tier or "normal",
        "deadlineOverride": student.deadline_override,
        "deadlineChangeConfirmed": bool(student.deadline_change_confirmed),
        "effectiveDeadline": submission.effective_deadline(student, deadlines),
        "deadlineNeedsConfirm": submission.deadline_needs_confirm_warning(student),
    }


@router.patch("/{student_id}/wrap-up")
def patch_wrap_up(
    student_id: str,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """{wrappedUp: bool}。仅影响呈现，不参与任何计算（D8）。"""
    student = _own_student(db, student_id, tutor.id)
    student.wrapped_up_at = datetime.now(timezone.utc) if body.get("wrappedUp") else None
    db.commit()
    return {"ok": True, "wrappedUpAt": student.wrapped_up_at.isoformat() if student.wrapped_up_at else None}


@router.patch("/{student_id}/tii-checks")
def patch_tii_checks(
    student_id: str,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """{tiiChecks: [{date, aiPercent, similarityPercent, note}]}；百分比允许为空（D7）。"""
    student = _own_student(db, student_id, tutor.id)
    student.tii_checks = list(body.get("tiiChecks") or [])
    db.commit()
    return {"ok": True, "tiiChecks": student.tii_checks}


@router.patch("/{student_id}/defense-confirmed")
def patch_defense_confirmed(
    student_id: str,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """{confirmed: bool} —— 最终答辩时间是否已跟学生确认。日期本身取自 isFinalDefense 的 session。"""
    student = _own_student(db, student_id, tutor.id)
    student.defense_confirmed = bool(body.get("confirmed"))
    db.commit()
    return {"ok": True, "defenseConfirmed": student.defense_confirmed}


# ── Resit（二次提交）—— 见 app/resit.py / ADR 0007 ───────────────────────────────

@router.post("/{student_id}/resit", response_model=StudentSchema)
def start_resit(
    student_id: str,
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """{round, saHoursTotal}。当前这次提交存成快照，学生进入 resit 轮次从头开始。"""
    student = _load_student(db, student_id, tutor.id)
    new_round = rounds.normalize_round(str(body.get("round") or "").strip())
    if not new_round:
        raise HTTPException(status_code=422, detail="请选择 resit 轮次")
    if new_round == student.submission_round:
        raise HTTPException(status_code=422, detail="resit 轮次不能和当前提交轮次相同")
    try:
        sa_total = int(body.get("saHoursTotal", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="课时额度必须是整数")
    if sa_total < 0:
        raise HTTPException(status_code=422, detail="课时额度不能为负")

    from_round = student.submission_round
    resit.start(db, student, new_round, sa_total)
    log_action(db, tutor, "update", "student", student.id,
               {"resit": "start", "from": from_round, "to": new_round})
    db.commit()
    return _to_full_schema(_load_student(db, student.id, tutor.id), submission.round_deadlines(db))


@router.delete("/{student_id}/resit", response_model=StudentSchema)
def undo_resit(
    student_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """撤销最近一次 resit：快照恢复，resit 期间的课并回上一次提交。"""
    student = _load_student(db, student_id, tutor.id)
    if not student.previous_attempts:
        raise HTTPException(status_code=409, detail="该学生没有进行中的 resit")
    resit.undo(db, student)
    log_action(db, tutor, "update", "student", student.id, {"resit": "undo"})
    db.commit()
    return _to_full_schema(_load_student(db, student.id, tutor.id), submission.round_deadlines(db))
