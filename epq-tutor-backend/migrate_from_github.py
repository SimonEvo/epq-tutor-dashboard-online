"""
One-time migration: pull all student JSON from epq-tutor-data → insert into MySQL.

Usage:
  GITHUB_PAT=ghp_xxx python migrate_from_github.py

Requires TUTOR_USERNAME to exist in DB (run init_tutor.py first).
Idempotent: skips students/supervisors that already exist by id.
"""
import os
import json
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from app.database import SessionLocal
from app import models

load_dotenv()

PAT = os.getenv("GITHUB_PAT")
OWNER = "SimonEvo"
REPO = "epq-tutor-data"
TUTOR_USERNAME = os.getenv("TUTOR_USERNAME", "admin")

if not PAT:
    print("ERROR: Set GITHUB_PAT env var.")
    exit(1)

HEADERS = {"Authorization": f"token {PAT}", "Accept": "application/vnd.github.v3+json"}
API = f"https://api.github.com/repos/{OWNER}/{REPO}"


def gh_get_json(path: str):
    url = f"{API}/contents/{path}"
    r = requests.get(url, headers=HEADERS)
    r.raise_for_status()
    import base64
    content = r.json()
    if isinstance(content, list):
        return content
    return json.loads(base64.b64decode(content["content"]).decode())


def now_utc():
    return datetime.now(timezone.utc)


db = SessionLocal()

# ── Get tutor ─────────────────────────────────────────────────────────────────
tutor = db.query(models.Tutor).filter(models.Tutor.username == TUTOR_USERNAME).first()
if not tutor:
    print(f"ERROR: Tutor '{TUTOR_USERNAME}' not found. Run init_tutor.py first.")
    exit(1)

# ── Tags ──────────────────────────────────────────────────────────────────────
print("Fetching tags...")
try:
    tags_data = gh_get_json("config/tags.json")
    for name in tags_data.get("tags", []):
        if not db.query(models.Tag).filter(models.Tag.name == name).first():
            db.add(models.Tag(name=name))
    db.commit()
    print(f"  Tags: {len(tags_data.get('tags', []))} imported")
except Exception as e:
    print(f"  Tags: skipped ({e})")

# ── Weekly report (latest) ────────────────────────────────────────────────────
print("Fetching weekly report...")
try:
    wr = gh_get_json("config/weekly_report.json")
    db.add(models.WeeklyReport(
        generated_at=wr.get("generatedAt", now_utc().isoformat()),
        content=wr.get("content", ""),
        last_scan_at=wr.get("cache", {}).get("lastScanAt", now_utc().isoformat()),
        student_cache=wr.get("cache", {}).get("students", {}),
    ))
    db.commit()
    print("  Weekly report imported")
except Exception as e:
    print(f"  Weekly report: skipped ({e})")

# ── Archived reports ──────────────────────────────────────────────────────────
print("Fetching archived reports...")
try:
    report_files = gh_get_json("reports")
    report_files = [f["name"] for f in report_files if f["name"].endswith(".json")]
    r_imported = 0
    for fname in sorted(report_files):
        try:
            d = gh_get_json(f"reports/{fname}")
            db.add(models.WeeklyReport(
                generated_at=d.get("generatedAt", now_utc().isoformat()),
                content=d.get("content", ""),
                last_scan_at=d.get("generatedAt", now_utc().isoformat()),
                student_cache={},
            ))
            r_imported += 1
        except Exception as e:
            print(f"  SKIP {fname}: {e}")
    db.commit()
    print(f"  Archived reports: {r_imported} imported")
except Exception as e:
    print(f"  Archived reports: skipped ({e})")

# ── Supervisors ───────────────────────────────────────────────────────────────
print("Fetching supervisors...")
try:
    sv_files = gh_get_json("supervisors")
    sv_files = [f["name"] for f in sv_files if f["name"].endswith(".json")]
    sv_imported = sv_skipped = 0
    for fname in sv_files:
        try:
            d = gh_get_json(f"supervisors/{fname}")
        except Exception as e:
            print(f"  SKIP {fname}: {e}")
            continue
        sv_id = d.get("id")
        if not sv_id:
            print(f"  SKIP {fname}: no id")
            continue
        existing_sv = db.query(models.Supervisor).filter(models.Supervisor.id == sv_id).first()
        if existing_sv:
            existing_sv.name = d.get("name", "")
            existing_sv.gender = d.get("gender")
            existing_sv.education = d.get("education")
            existing_sv.background = d.get("background")
            existing_sv.direction = d.get("direction")
            existing_sv.notes = d.get("notes")
            existing_sv.sa_type = d.get("saType")
            sv_skipped += 1
        else:
            db.add(models.Supervisor(
                id=sv_id,
                name=d.get("name", ""),
                gender=d.get("gender"),
                education=d.get("education"),
                background=d.get("background"),
                direction=d.get("direction"),
                notes=d.get("notes"),
                sa_type=d.get("saType"),
            ))
            sv_imported += 1
    db.commit()
    print(f"  Supervisors: {sv_imported} imported, {sv_skipped} updated")
except Exception as e:
    print(f"  Supervisors: skipped ({e})")

# ── Students ──────────────────────────────────────────────────────────────────
print("Fetching student list...")
file_list = gh_get_json("students")
student_files = [f["name"] for f in file_list if f["name"].endswith(".json")]
print(f"  Found {len(student_files)} student files")

imported = skipped = 0

for fname in student_files:
    try:
        d = gh_get_json(f"students/{fname}")
    except Exception as e:
        print(f"  SKIP {fname}: {e}")
        continue

    student_id = d.get("id")
    if not student_id:
        print(f"  SKIP {fname}: no id")
        continue

    existing = db.query(models.Student).filter(models.Student.id == student_id).first()
    if existing:
        # Re-import sessions for existing students
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
        db.commit()
        print(f"  UPDATED sessions for {d.get('name', fname)}: {len(d.get('sessions', []))} sessions")
        skipped += 1
        continue

    # Ensure supervisor exists
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

    # Sessions
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

    # Milestones
    for mid, status in d.get("milestones", {}).items():
        db.add(models.StudentMilestone(student_id=student_id, milestone_id=mid, status=status))

    # Tags
    for tag_name in d.get("tags", []):
        tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
        if tag is None:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        s.tags.append(tag)

    # Personal entries
    for e in d.get("personalEntries", []):
        db.add(models.PersonalEntry(
            id=e["id"], student_id=student_id, date=e["date"],
            title=e["title"], content=e["content"], created_at=e.get("createdAt", ""),
        ))

    # Mind maps
    for m in d.get("mindMaps", []):
        db.add(models.MindMap(
            id=m["id"], student_id=student_id, date=m["date"],
            title=m["title"], content=m["content"], created_at=m.get("createdAt", ""),
        ))

    db.commit()
    print(f"  OK  {d.get('name', fname)}")
    imported += 1

db.close()
print(f"\nDone. Imported: {imported}, Skipped: {skipped}")
