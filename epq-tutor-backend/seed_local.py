"""本地压测/外观验证用假数据。仅供 dev，不要在服务器上跑。

用法：
    .venv/Scripts/python.exe seed_local.py                 # 30 学生 / 一年跨度
    .venv/Scripts/python.exe seed_local.py --students 60 --span-days 540
"""
import argparse
import random
import uuid
from datetime import date, timedelta

from dotenv import load_dotenv

load_dotenv()

from app.database import SessionLocal, engine  # noqa: E402
from app import models  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--students", type=int, default=30)
ap.add_argument("--span-days", type=int, default=365, help="session 日期总跨度（决定甘特图列数）")
ap.add_argument("--seed", type=int, default=42)
args = ap.parse_args()

rnd = random.Random(args.seed)
models.Base.metadata.create_all(engine)
db = SessionLocal()

tutor = db.query(models.Tutor).first()
if not tutor:
    raise SystemExit("先跑 init_tutor.py 建账号")

# ── 清掉上一次的假数据（只删 seed- 前缀的，真数据不碰） ────────────────────────
old_ids = [s.id for s in db.query(models.Student).filter(models.Student.id.like("seed-%")).all()]
if old_ids:
    db.query(models.Session).filter(models.Session.student_id.in_(old_ids)).delete(synchronize_session=False)
    db.query(models.Student).filter(models.Student.id.in_(old_ids)).delete(synchronize_session=False)
db.query(models.Supervisor).filter(models.Supervisor.id.like("seed-%")).delete(synchronize_session=False)
db.commit()

# ── 督导：中方SA / 英方SA 各一 ────────────────────────────────────────────────
sups = []
for i, sa_type in enumerate(["中方SA", "英方SA"]):
    sv = models.Supervisor(id=f"seed-sv-{i}", name=f"假督导{i}", sa_type=sa_type)
    db.add(sv)
    sups.append(sv)

# ── 学期 ────────────────────────────────────────────────────────────────────
ROUNDS = ["2026-1月届", "2026-8月届"]
for r in ROUNDS:
    if not db.get(models.Round, r):
        db.add(models.Round(name=r, is_archived=False))

today = date.today()
start = today - timedelta(days=args.span_days * 2 // 3)
end = start + timedelta(days=args.span_days)

SESSION_TYPES = ["SA_MEETING", "TA_MEETING", "THEORY"]

students = []
for i in range(args.students):
    sid = f"seed-stu-{i:03d}"
    wrapped = None
    if i % 10 == 9:  # 每 10 个结项 1 个，验折叠分组
        wrapped = today - timedelta(days=rnd.randint(1, 60))
    st = models.Student(
        id=sid,
        tutor_id=tutor.id,
        name=f"假学生{i:02d}",
        topic=f"Fake EPQ topic #{i}",
        overview=f"假概述 {i}",
        submission_round=ROUNDS[i % len(ROUNDS)],
        supervisor_id=sups[i % 2].id,
        sa_hours_total=12,
        sa_hours_used=rnd.uniform(0, 12),
        wrapped_up_at=wrapped,
    )
    db.add(st)
    students.append(st)

    # 每人 15~30 节课，随机撒在跨度内；刻意造同日多节课来验堆叠
    n = rnd.randint(15, 30)
    for k in range(n):
        d = start + timedelta(days=rnd.randint(0, args.span_days))
        stype = rnd.choice(SESSION_TYPES)
        db.add(models.Session(
            id=str(uuid.uuid4()),
            student_id=sid,
            type=stype,
            date=d.isoformat(),
            time=f"{rnd.randint(9, 19):02d}:00",
            duration_minutes=60,
            title=f"{stype} #{k}",
            feedback_sent=rnd.random() < 0.5,
            is_final_defense=(k == n - 1 and stype == "SA_MEETING"),
        ))

# ── 甘特图项目：每个学生一个 section + 任务/里程碑，另加「固定安排」 ──────────
sections = [{"id": f"sec-{s.id}", "name": s.name} for s in students]
sections.append({"id": "sec-fixed", "name": "固定安排"})

tasks = []
for s in students:
    base = start + timedelta(days=rnd.randint(0, args.span_days // 2))
    for j in range(3):
        t0 = base + timedelta(days=j * 30)
        tasks.append({
            "id": str(uuid.uuid4()), "sectionId": f"sec-{s.id}",
            "name": f"阶段{j + 1}", "startDate": t0.isoformat(),
            "endDate": (t0 + timedelta(days=rnd.randint(7, 25))).isoformat(),
            "milestone": False, "color": rnd.choice(["#6366f1", "#0ea5e9", "#14b8a6"]),
        })
    m = base + timedelta(days=100)
    tasks.append({
        "id": str(uuid.uuid4()), "sectionId": f"sec-{s.id}",
        "name": "里程碑", "startDate": m.isoformat(), "endDate": m.isoformat(),
        "milestone": True,
    })

for label, offset, length in [("出差", 40, 5), ("提交截止", 200, 0)]:
    d0 = start + timedelta(days=offset)
    tasks.append({
        "id": str(uuid.uuid4()), "sectionId": "sec-fixed", "name": label,
        "startDate": d0.isoformat(),
        "endDate": (d0 + timedelta(days=length)).isoformat() if length else "",
        "milestone": length == 0, "color": "#f59e0b",
    })

proj = db.query(models.GanttProject).filter(
    models.GanttProject.tutor_id == tutor.id,
    models.GanttProject.owner_type == "tutor",
    models.GanttProject.owner_id.is_(None),
).first()
data = {"projectName": "假项目", "sections": sections, "tasks": tasks}
if proj:
    proj.data = data
else:
    db.add(models.GanttProject(
        id=str(uuid.uuid4()), tutor_id=tutor.id, owner_type="tutor",
        owner_id=None, name="假项目", data=data,
    ))

db.commit()
db.close()
print(f"seeded: {args.students} students, span {args.span_days}d "
      f"({start} → {end}), {len(tasks)} gantt tasks")
