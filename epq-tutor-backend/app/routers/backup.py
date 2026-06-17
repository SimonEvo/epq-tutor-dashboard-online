import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app import models
from app.auth import get_current_tutor

router = APIRouter(prefix="/api/backup", tags=["backup"])

BACKUP_DIR = Path(os.getenv("BACKUP_DIR", "/opt/epq-tutor-data_backup"))
MAX_BACKUPS = 3


def _write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _today_dir() -> Path:
    return BACKUP_DIR / datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _cleanup_old_backups() -> None:
    if not BACKUP_DIR.exists():
        return
    dirs = sorted(
        [d for d in BACKUP_DIR.iterdir() if d.is_dir() and len(d.name) == 10],
        reverse=True,
    )
    for old in dirs[MAX_BACKUPS:]:
        shutil.rmtree(old, ignore_errors=True)


def _serialize_student(s: models.Student) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "nameEn": s.name_en,
        "gender": s.gender,
        "school": s.school,
        "submissionRound": s.submission_round,
        "taughtElementType": s.taught_element_type,
        "universityAspiration": s.university_aspiration,
        "currentGrade": s.current_grade,
        "universityEnrollment": s.university_enrollment,
        "contact": s.contact,
        "supervisorId": s.supervisor_id,
        "topic": s.topic or "",
        "topicZh": s.topic_zh or "",
        "overview": s.overview,
        "saHoursTotal": s.sa_hours_total,
        "saHoursUsed": s.sa_hours_used,
        "nextSaSession": s.next_sa_session,
        "nextTaSession": s.next_ta_session,
        "nextTheorySession": s.next_theory_session,
        "availabilityNote": s.availability_note or "",
        "briefNote": s.brief_note or "",
        "scheduleEntries": s.schedule_entries or [],
        "privateNotes": s.private_notes or "",
        "tencentDocUrl": s.tencent_doc_url,
        "aiAlias": s.ai_alias,
        "generatedProgressReport": s.generated_progress_report,
        "progressReportGeneratedAt": s.progress_report_generated_at,
        "createdAt": s.created_at.isoformat() if s.created_at else "",
        "updatedAt": s.updated_at.isoformat() if s.updated_at else "",
        "milestones": {m.milestone_id: m.status for m in s.milestones},
        "tags": [t.name for t in s.tags],
        "sessions": [
            {
                "id": x.id, "type": x.type, "date": x.date, "time": x.time,
                "durationMinutes": x.duration_minutes, "title": x.title,
                "summary": x.summary or "", "homework": x.homework or "",
                "transcript": x.transcript or "", "privateNotes": x.private_notes or "",
                "generatedReport": x.generated_report,
                "reportGeneratedAt": x.report_generated_at,
                "zoomMeetingId": x.zoom_meeting_id,
                "zoomJoinUrl": x.zoom_join_url,
                "zoomPassword": x.zoom_password,
                "createdAt": x.created_at.isoformat() if x.created_at else "",
            }
            for x in sorted(s.sessions, key=lambda x: x.date)
        ],
        "personalEntries": [
            {"id": e.id, "date": e.date, "title": e.title,
             "content": e.content, "createdAt": e.created_at}
            for e in s.personal_entries
        ],
        "mindMaps": [
            {"id": m.id, "date": m.date, "title": m.title,
             "content": m.content, "createdAt": m.created_at}
            for m in s.mind_maps
        ],
        "homeworkEntries": [
            {"id": h.id, "sessionId": h.session_id, "date": h.date,
             "sourceLabel": h.source_label, "deadline": h.deadline,
             "items": h.items, "comments": h.comments, "createdAt": h.created_at}
            for h in s.homework_entries
        ],
    }


def run_backup(db: Session) -> dict:
    """可直接调用（无需 HTTP 上下文），供定时任务使用。"""
    dest = _today_dir()
    counts = {"students": 0, "supervisors": 0}

    students = (
        db.query(models.Student)
        .options(
            selectinload(models.Student.sessions),
            selectinload(models.Student.milestones),
            selectinload(models.Student.tags),
            selectinload(models.Student.personal_entries),
            selectinload(models.Student.mind_maps),
            selectinload(models.Student.homework_entries),
        )
        .all()
    )
    for s in students:
        _write(dest / "students" / f"{s.id}.json", _serialize_student(s))
        counts["students"] += 1

    supervisors = db.query(models.Supervisor).all()
    for sv in supervisors:
        _write(dest / "supervisors" / f"{sv.id}.json", {
            "id": sv.id, "name": sv.name, "gender": sv.gender,
            "education": sv.education, "background": sv.background,
            "direction": sv.direction, "notes": sv.notes, "saType": sv.sa_type,
        })
        counts["supervisors"] += 1

    tags = [t.name for t in db.query(models.Tag).all()]
    _write(dest / "config" / "tags.json", {"tags": tags})

    wr = db.query(models.WeeklyReport).order_by(models.WeeklyReport.id.desc()).first()
    if wr:
        _write(dest / "config" / "weekly_report.json", {
            "generatedAt": wr.generated_at,
            "content": wr.content,
            "cache": {"lastScanAt": wr.last_scan_at, "students": wr.student_cache or {}},
        })

    _cleanup_old_backups()

    return {
        "ok": True,
        "path": str(dest),
        "students": counts["students"],
        "supervisors": counts["supervisors"],
        "tags": len(tags),
    }


@router.post("/export")
def export_backup(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    return run_backup(db)


@router.get("/list")
def list_backups(
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    if not BACKUP_DIR.exists():
        return []
    result = []
    for d in sorted(BACKUP_DIR.iterdir(), reverse=True):
        if not d.is_dir() or len(d.name) != 10:
            continue
        student_count = len(list((d / "students").glob("*.json"))) if (d / "students").exists() else 0
        supervisor_count = len(list((d / "supervisors").glob("*.json"))) if (d / "supervisors").exists() else 0
        result.append({
            "date": d.name,
            "students": student_count,
            "supervisors": supervisor_count,
        })
    return result


@router.post("/restore/{date}")
def restore_backup(
    date: str,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    src = BACKUP_DIR / date
    if not src.is_dir():
        raise HTTPException(status_code=404, detail=f"备份 {date} 不存在")

    restored = {"students": 0, "supervisors": 0, "tags": 0}

    # ── Supervisors first (students may reference them) ──────────────────────
    sv_dir = src / "supervisors"
    if sv_dir.exists():
        for f in sv_dir.glob("*.json"):
            data = json.loads(f.read_text("utf-8"))
            sv = db.get(models.Supervisor, data["id"])
            if not sv:
                sv = models.Supervisor(id=data["id"])
                db.add(sv)
            sv.name = data.get("name", "")
            sv.gender = data.get("gender")
            sv.education = data.get("education")
            sv.background = data.get("background")
            sv.direction = data.get("direction")
            sv.notes = data.get("notes")
            sv.sa_type = data.get("saType")
            restored["supervisors"] += 1

    # ── Tags ─────────────────────────────────────────────────────────────────
    tags_file = src / "config" / "tags.json"
    if tags_file.exists():
        tag_names = json.loads(tags_file.read_text("utf-8")).get("tags", [])
        for name in tag_names:
            exists = db.query(models.Tag).filter(models.Tag.name == name).first()
            if not exists:
                db.add(models.Tag(name=name))
            restored["tags"] += 1

    db.flush()

    # ── Students ─────────────────────────────────────────────────────────────
    stu_dir = src / "students"
    if stu_dir.exists():
        for f in stu_dir.glob("*.json"):
            data = json.loads(f.read_text("utf-8"))
            sid = data["id"]
            s = (
                db.query(models.Student)
                .options(
                    selectinload(models.Student.sessions),
                    selectinload(models.Student.milestones),
                    selectinload(models.Student.personal_entries),
                    selectinload(models.Student.mind_maps),
                    selectinload(models.Student.homework_entries),
                )
                .filter(models.Student.id == sid)
                .first()
            )
            if not s:
                s = models.Student(id=sid, tutor_id=_tutor.id, name=data.get("name", ""))
                db.add(s)

            # Scalar fields
            s.name = data.get("name", "")
            s.name_en = data.get("nameEn")
            s.gender = data.get("gender")
            s.school = data.get("school")
            s.submission_round = data.get("submissionRound")
            s.taught_element_type = data.get("taughtElementType")
            s.university_aspiration = data.get("universityAspiration")
            s.current_grade = data.get("currentGrade")
            s.university_enrollment = data.get("universityEnrollment")
            s.contact = data.get("contact")
            s.supervisor_id = data.get("supervisorId")
            s.topic = data.get("topic", "")
            s.topic_zh = data.get("topicZh", "")
            s.overview = data.get("overview")
            s.sa_hours_total = data.get("saHoursTotal", 12)
            s.sa_hours_used = data.get("saHoursUsed", 0)
            s.next_sa_session = data.get("nextSaSession")
            s.next_ta_session = data.get("nextTaSession")
            s.next_theory_session = data.get("nextTheorySession")
            s.availability_note = data.get("availabilityNote", "")
            s.brief_note = data.get("briefNote", "")
            s.schedule_entries = data.get("scheduleEntries", [])
            s.private_notes = data.get("privateNotes", "")
            s.tencent_doc_url = data.get("tencentDocUrl")
            s.ai_alias = data.get("aiAlias")
            s.generated_progress_report = data.get("generatedProgressReport")
            s.progress_report_generated_at = data.get("progressReportGeneratedAt")

            # ── Replace sessions ─────────────────────────────────────────────
            for sess in list(s.sessions):
                db.delete(sess)
            db.flush()
            for sx in data.get("sessions", []):
                db.add(models.Session(
                    id=sx["id"], student_id=sid, type=sx["type"],
                    date=sx["date"], time=sx.get("time"),
                    duration_minutes=sx.get("durationMinutes", 60),
                    title=sx.get("title"), summary=sx.get("summary", ""),
                    homework=sx.get("homework", ""), transcript=sx.get("transcript", ""),
                    private_notes=sx.get("privateNotes", ""),
                    generated_report=sx.get("generatedReport"),
                    report_generated_at=sx.get("reportGeneratedAt"),
                    zoom_meeting_id=sx.get("zoomMeetingId"),
                    zoom_join_url=sx.get("zoomJoinUrl"),
                    zoom_password=sx.get("zoomPassword"),
                ))

            # ── Replace milestones ───────────────────────────────────────────
            for m in list(s.milestones):
                db.delete(m)
            db.flush()
            for mid, status in data.get("milestones", {}).items():
                db.add(models.StudentMilestone(
                    student_id=sid, milestone_id=mid, status=status,
                ))

            # ── Replace personal entries ─────────────────────────────────────
            for e in list(s.personal_entries):
                db.delete(e)
            db.flush()
            for ex in data.get("personalEntries", []):
                db.add(models.PersonalEntry(
                    id=ex["id"], student_id=sid, date=ex["date"],
                    title=ex["title"], content=ex["content"],
                    created_at=ex.get("createdAt", ""),
                ))

            # ── Replace mind maps ────────────────────────────────────────────
            for m in list(s.mind_maps):
                db.delete(m)
            db.flush()
            for mx in data.get("mindMaps", []):
                db.add(models.MindMap(
                    id=mx["id"], student_id=sid, date=mx["date"],
                    title=mx["title"], content=mx["content"],
                    created_at=mx.get("createdAt", ""),
                ))

            # ── Replace homework entries ─────────────────────────────────────
            for h in list(s.homework_entries):
                db.delete(h)
            db.flush()
            for hx in data.get("homeworkEntries", []):
                db.add(models.HomeworkEntry(
                    id=hx["id"], student_id=sid, session_id=hx.get("sessionId"),
                    date=hx["date"], source_label=hx.get("sourceLabel", ""),
                    deadline=hx.get("deadline"), items=hx.get("items", []),
                    comments=hx.get("comments", ""),
                    created_at=hx.get("createdAt", ""),
                ))

            # ── Tags ─────────────────────────────────────────────────────────
            db.execute(
                models.StudentTag.__table__.delete().where(
                    models.StudentTag.student_id == sid
                )
            )
            for tag_name in data.get("tags", []):
                tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
                if tag:
                    db.execute(
                        models.StudentTag.__table__.insert().values(
                            student_id=sid, tag_id=tag.id,
                        )
                    )

            restored["students"] += 1

    # ── Weekly report ────────────────────────────────────────────────────────
    wr_file = src / "config" / "weekly_report.json"
    if wr_file.exists():
        wr_data = json.loads(wr_file.read_text("utf-8"))
        db.query(models.WeeklyReport).delete()
        db.add(models.WeeklyReport(
            generated_at=wr_data.get("generatedAt", ""),
            content=wr_data.get("content", ""),
            last_scan_at=wr_data.get("cache", {}).get("lastScanAt", ""),
            student_cache=wr_data.get("cache", {}).get("students", {}),
        ))

    db.commit()
    return {"ok": True, "restored": restored}
