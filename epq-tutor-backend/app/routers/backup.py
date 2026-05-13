import json
import os
from pathlib import Path
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app import models
from app.auth import get_current_tutor

router = APIRouter(prefix="/api/backup", tags=["backup"])

BACKUP_DIR = Path(os.getenv("BACKUP_DIR", "/opt/epq-tutor-data_backup"))


def _write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@router.post("/export")
def export_backup(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    counts = {"students": 0, "supervisors": 0}

    # ── Students ──────────────────────────────────────────────────────────────
    students = (
        db.query(models.Student)
        .options(
            selectinload(models.Student.sessions),
            selectinload(models.Student.milestones),
            selectinload(models.Student.tags),
            selectinload(models.Student.personal_entries),
            selectinload(models.Student.mind_maps),
        )
        .all()
    )
    for s in students:
        data = {
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
            "overview": s.overview,
            "saHoursTotal": s.sa_hours_total,
            "saHoursUsed": s.sa_hours_used,
            "nextSaSession": s.next_sa_session,
            "nextTaSession": s.next_ta_session,
            "nextTheorySession": s.next_theory_session,
            "availabilityNote": s.availability_note or "",
            "briefNote": s.brief_note or "",
            "privateNotes": s.private_notes or "",
            "tencentDocUrl": s.tencent_doc_url,
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
        }
        _write(BACKUP_DIR / "students" / f"{s.id}.json", data)
        counts["students"] += 1

    # ── Supervisors ───────────────────────────────────────────────────────────
    supervisors = db.query(models.Supervisor).all()
    for sv in supervisors:
        data = {
            "id": sv.id, "name": sv.name, "gender": sv.gender,
            "education": sv.education, "background": sv.background,
            "direction": sv.direction, "notes": sv.notes, "saType": sv.sa_type,
        }
        _write(BACKUP_DIR / "supervisors" / f"{sv.id}.json", data)
        counts["supervisors"] += 1

    # ── Tags ──────────────────────────────────────────────────────────────────
    tags = [t.name for t in db.query(models.Tag).all()]
    _write(BACKUP_DIR / "config" / "tags.json", {"tags": tags})

    # ── Weekly report ─────────────────────────────────────────────────────────
    wr = db.query(models.WeeklyReport).order_by(models.WeeklyReport.id.desc()).first()
    if wr:
        _write(BACKUP_DIR / "config" / "weekly_report.json", {
            "generatedAt": wr.generated_at,
            "content": wr.content,
            "cache": {"lastScanAt": wr.last_scan_at, "students": wr.student_cache or {}},
        })

    return {
        "ok": True,
        "path": str(BACKUP_DIR),
        "students": counts["students"],
        "supervisors": counts["supervisors"],
        "tags": len(tags),
    }
