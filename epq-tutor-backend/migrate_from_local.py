"""
Local file migration: read student/supervisor JSON files from disk → insert into MySQL.

Usage:
  python migrate_from_local.py --data-dir /path/to/epq-tutor-data

Directory structure expected:
  <data-dir>/
    students/       *.json
    supervisors/    *.json  (optional)
    config/
      tags.json     (optional)
      weekly_report.json (optional)

Idempotent: updates sessions/supervisors for existing records.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from app.database import SessionLocal
from app import models

load_dotenv()

parser = argparse.ArgumentParser()
parser.add_argument('--data-dir', required=True, help='Path to epq-tutor-data directory')
args = parser.parse_args()

DATA = Path(args.data_dir)
TUTOR_USERNAME = os.getenv("TUTOR_USERNAME", "admin")


def now_utc():
    return datetime.now(timezone.utc)


def read_json(path: Path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


db = SessionLocal()

tutor = db.query(models.Tutor).filter(models.Tutor.username == TUTOR_USERNAME).first()
if not tutor:
    print(f"ERROR: Tutor '{TUTOR_USERNAME}' not found. Run init_tutor.py first.")
    exit(1)

# ── Tags ──────────────────────────────────────────────────────────────────────
tags_file = DATA / 'config' / 'tags.json'
if tags_file.exists():
    tags_data = read_json(tags_file)
    for name in tags_data.get("tags", []):
        if not db.query(models.Tag).filter(models.Tag.name == name).first():
            db.add(models.Tag(name=name))
    db.commit()
    print(f"Tags: {len(tags_data.get('tags', []))} processed")
else:
    print("Tags: skipped (no file)")

# ── Weekly report ─────────────────────────────────────────────────────────────
wr_file = DATA / 'config' / 'weekly_report.json'
if wr_file.exists():
    wr = read_json(wr_file)
    db.add(models.WeeklyReport(
        generated_at=wr.get("generatedAt", now_utc().isoformat()),
        content=wr.get("content", ""),
        last_scan_at=wr.get("cache", {}).get("lastScanAt", now_utc().isoformat()),
        student_cache=wr.get("cache", {}).get("students", {}),
    ))
    db.commit()
    print("Weekly report: imported")

# ── Supervisors ───────────────────────────────────────────────────────────────
sv_dir = DATA / 'supervisors'
if sv_dir.exists():
    sv_imported = sv_updated = 0
    for f in sv_dir.glob("*.json"):
        d = read_json(f)
        sv_id = d.get("id")
        if not sv_id:
            continue
        existing = db.query(models.Supervisor).filter(models.Supervisor.id == sv_id).first()
        if existing:
            existing.name = d.get("name", "")
            existing.gender = d.get("gender")
            existing.education = d.get("education")
            existing.background = d.get("background")
            existing.direction = d.get("direction")
            existing.notes = d.get("notes")
            existing.sa_type = d.get("saType")
            sv_updated += 1
        else:
            db.add(models.Supervisor(
                id=sv_id, name=d.get("name", ""),
                gender=d.get("gender"), education=d.get("education"),
                background=d.get("background"), direction=d.get("direction"),
                notes=d.get("notes"), sa_type=d.get("saType"),
            ))
            sv_imported += 1
    db.commit()
    print(f"Supervisors: {sv_imported} imported, {sv_updated} updated")

# ── Students ──────────────────────────────────────────────────────────────────
student_dir = DATA / 'students'
imported = updated = 0

for f in sorted(student_dir.glob("*.json")):
    d = read_json(f)
    student_id = d.get("id")
    if not student_id:
        print(f"  SKIP {f.name}: no id")
        continue

    existing = db.query(models.Student).filter(models.Student.id == student_id).first()

    if existing:
        # Update sessions for existing student
        db.query(models.Session).filter(models.Session.student_id == student_id).delete()
        for sd in d.get("sessions", []):
            db.add(models.Session(
                id=sd["id"], student_id=student_id,
                type=sd["type"], date=sd["date"], time=sd.get("time"),
                duration_minutes=sd.get("durationMinutes", 60),
                title=sd.get("title"), summary=sd.get("summary", ""),
                homework=sd.get("homework", ""), transcript=sd.get("transcript", ""),
                private_notes=sd.get("privateNotes", ""),
                generated_report=sd.get("generatedReport"),
                report_generated_at=sd.get("reportGeneratedAt"),
                created_at=datetime.fromisoformat(sd["createdAt"]) if sd.get("createdAt") else now_utc(),
            ))
        # Update core fields
        existing.name = d.get("name", "")
        existing.name_en = d.get("nameEn")
        existing.topic = d.get("topic", "")
        existing.overview = d.get("overview")
        existing.school = d.get("school")
        existing.submission_round = d.get("submissionRound")
        existing.supervisor_id = d.get("supervisorId")
        existing.sa_hours_total = d.get("saHoursTotal", 12)
        existing.brief_note = d.get("briefNote", "")
        existing.private_notes = d.get("privateNotes", "")
        existing.availability_note = d.get("availabilityNote", "")
        db.commit()
        print(f"  UPDATED {d.get('name', f.name)}: {len(d.get('sessions', []))} sessions")
        updated += 1
        continue

    # New student
    sv_id = d.get("supervisorId")
    if sv_id and not db.query(models.Supervisor).filter(models.Supervisor.id == sv_id).first():
        db.add(models.Supervisor(id=sv_id, name=f"督导_{sv_id[:8]}"))
        db.flush()

    s = models.Student(
        id=student_id, tutor_id=tutor.id,
        name=d.get("name", ""), name_en=d.get("nameEn"),
        gender=d.get("gender"), school=d.get("school"),
        submission_round=d.get("submissionRound"),
        taught_element_type=d.get("taughtElementType"),
        university_aspiration=d.get("universityAspiration"),
        current_grade=d.get("currentGrade"),
        university_enrollment=d.get("universityEnrollment"),
        contact=d.get("contact"), supervisor_id=sv_id,
        topic=d.get("topic", ""), overview=d.get("overview"),
        sa_hours_total=d.get("saHoursTotal", 12),
        sa_hours_used=d.get("saHoursUsed", 0),
        next_sa_session=d.get("nextSaSession"),
        next_ta_session=d.get("nextTaSession"),
        next_theory_session=d.get("nextTheorySession"),
        availability_note=d.get("availabilityNote", ""),
        brief_note=d.get("briefNote", ""),
        private_notes=d.get("privateNotes", ""),
        tencent_doc_url=d.get("tencentDocUrl"),
        generated_progress_report=d.get("generatedProgressReport"),
        progress_report_generated_at=d.get("progressReportGeneratedAt"),
        created_at=datetime.fromisoformat(d["createdAt"]) if d.get("createdAt") else now_utc(),
        updated_at=datetime.fromisoformat(d["updatedAt"]) if d.get("updatedAt") else now_utc(),
    )
    db.add(s)
    db.flush()

    for sd in d.get("sessions", []):
        db.add(models.Session(
            id=sd["id"], student_id=student_id,
            type=sd["type"], date=sd["date"], time=sd.get("time"),
            duration_minutes=sd.get("durationMinutes", 60),
            title=sd.get("title"), summary=sd.get("summary", ""),
            homework=sd.get("homework", ""), transcript=sd.get("transcript", ""),
            private_notes=sd.get("privateNotes", ""),
            generated_report=sd.get("generatedReport"),
            report_generated_at=sd.get("reportGeneratedAt"),
            created_at=datetime.fromisoformat(sd["createdAt"]) if sd.get("createdAt") else now_utc(),
        ))

    for mid, status in d.get("milestones", {}).items():
        db.add(models.StudentMilestone(student_id=student_id, milestone_id=mid, status=status))

    for tag_name in d.get("tags", []):
        tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
        if tag is None:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        s.tags.append(tag)

    for e in d.get("personalEntries", []):
        db.add(models.PersonalEntry(
            id=e["id"], student_id=student_id, date=e["date"],
            title=e["title"], content=e["content"], created_at=e.get("createdAt", ""),
        ))

    for m in d.get("mindMaps", []):
        db.add(models.MindMap(
            id=m["id"], student_id=student_id, date=m["date"],
            title=m["title"], content=m["content"], created_at=m.get("createdAt", ""),
        ))

    db.commit()
    print(f"  IMPORTED {d.get('name', f.name)}: {len(d.get('sessions', []))} sessions")
    imported += 1

db.close()
print(f"\nDone. Imported: {imported}, Updated: {updated}")
