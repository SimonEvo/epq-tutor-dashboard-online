"""Resit（二次提交）：快照、重置、SA 分开计数、撤销。"""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import models
from app.auth import hash_password, token_for
from app.database import SessionLocal
from app.main import app, run_migrations


@pytest.fixture(scope="module")
def db():
    run_migrations()
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture(scope="module")
def tutor(db):
    t = models.Tutor(
        id=str(uuid.uuid4()), username=f"resit-{uuid.uuid4().hex[:6]}",
        password_hash=hash_password("x"), role="tutor", ics_token=uuid.uuid4().hex,
    )
    db.add(t)
    db.commit()
    return t


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def _hdr(t):
    return {"Authorization": f"Bearer {token_for(t)}"}


@pytest.fixture
def student(db, tutor):
    """26春 的学生：3 节 SA（其中 1 节答辩）、已结项、有 Tii 和里程碑。"""
    sid = f"stu-{uuid.uuid4().hex[:8]}"
    s = models.Student(
        id=sid, tutor_id=tutor.id, name="Resit 同学", topic="t",
        registration_round="26春", submission_round="26春",
        sa_hours_total=12, sa_hours_used=0,   # 故意存错，快照应按课现算
        deadline_tier="extended", deadline_change_confirmed=True,
        tii_checks=[{"date": "2026-07-01", "aiPercent": 30}],
        submission_checklist={"ticked": {"forms_checked": "2026-07-02"}, "customItems": []},
        wrapped_up_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        defense_confirmed=True,
    )
    db.add(s)
    db.flush()
    for i, (date, defense) in enumerate([("2026-05-01", False), ("2026-06-01", False), ("2026-07-20", True)]):
        db.add(models.Session(id=f"{sid}-s{i}", student_id=sid, type="SA_MEETING",
                              date=date, time="10:00", is_final_defense=defense))
    db.add(models.StudentMilestone(student_id=sid, milestone_id="form1", status="completed"))
    db.commit()
    return s


def _start(client, tutor, sid, **body):
    return client.post(f"/api/students/{sid}/resit",
                       json={"round": "26秋", "saHoursTotal": 4, **body}, headers=_hdr(tutor))


def test_start_snapshots_and_resets(client, tutor, student):
    r = _start(client, tutor, student.id)
    assert r.status_code == 200, r.text
    d = r.json()

    assert d["currentAttempt"] == 2
    assert d["submissionRound"] == "26秋"
    assert d["registrationRound"] == "26春"          # 签约批次不动
    assert d["previousRounds"] == ["26春"]

    # 新一轮从空白开始
    assert d["deadlineTier"] == "normal" and not d["deadlineChangeConfirmed"]
    assert d["tiiChecks"] == [] and d["wrappedUpAt"] is None and not d["defenseConfirmed"]
    assert d["submissionChecklist"]["ticked"] == {}
    assert d["milestones"] == {}
    assert d["saHoursTotal"] == 4 and d["saHoursUsed"] == 0

    # 第一次的东西都在快照里
    snap = d["previousAttempts"][0]
    assert snap["attempt"] == 1 and snap["submissionRound"] == "26春"
    assert snap["deadlineTier"] == "extended"
    assert snap["tiiChecks"] == [{"date": "2026-07-01", "aiPercent": 30}]
    assert snap["submissionChecklist"]["ticked"] == {"forms_checked": "2026-07-02"}
    assert snap["milestones"] == {"form1": "completed"}
    assert snap["wrappedUpAt"].startswith("2026-08-01")
    assert snap["saHoursTotal"] == 12
    assert snap["saHoursUsed"] == 2   # 按课程记录现算（夹具里存的是 2，答辩不算）

    # 老课都留在第 1 次
    assert {s["attempt"] for s in d["sessions"]} == {1}


def test_summary_carries_previous_rounds(client, tutor, student):
    _start(client, tutor, student.id)
    rows = client.get("/api/students", headers=_hdr(tutor)).json()
    row = next(x for x in rows if x["id"] == student.id)
    assert row["currentAttempt"] == 2 and row["previousRounds"] == ["26春"]
    assert {s["attempt"] for s in row["sessions"]} == {1}


def test_new_sessions_join_current_attempt_and_sa_counts_separately(client, tutor, student):
    full = _start(client, tutor, student.id).json()
    # 前端建课不带 attempt，saHoursUsed 按老逻辑数全部 SA —— 服务端都得纠正
    full["sessions"].append({"id": f"{student.id}-new", "type": "SA_MEETING",
                             "date": "2026-10-01", "time": "10:00"})
    full["saHoursUsed"] = 99
    r = client.put(f"/api/students/{student.id}", json=full, headers=_hdr(tutor))
    assert r.status_code == 200, r.text
    d = r.json()
    attempts = {s["id"]: s["attempt"] for s in d["sessions"]}
    assert attempts[f"{student.id}-new"] == 2
    assert attempts[f"{student.id}-s0"] == 1
    assert d["saHoursUsed"] == 1
    # 普通保存不得冲掉快照
    assert d["previousAttempts"][0]["submissionRound"] == "26春"


def test_save_clamps_out_of_range_attempt(client, tutor, student):
    full = client.get(f"/api/students/{student.id}", headers=_hdr(tutor)).json()
    full["sessions"][0]["attempt"] = 5   # 还没 resit，最多是 1
    d = client.put(f"/api/students/{student.id}", json=full, headers=_hdr(tutor)).json()
    assert {s["attempt"] for s in d["sessions"]} == {1}


def test_undo_restores_snapshot_and_merges_sessions(client, tutor, student):
    full = _start(client, tutor, student.id).json()
    full["sessions"].append({"id": f"{student.id}-new", "type": "SA_MEETING",
                             "date": "2026-10-01", "time": "10:00"})
    client.put(f"/api/students/{student.id}", json=full, headers=_hdr(tutor))

    r = client.delete(f"/api/students/{student.id}/resit", headers=_hdr(tutor))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["currentAttempt"] == 1 and d["previousAttempts"] == [] and d["previousRounds"] == []
    assert d["submissionRound"] == "26春"
    assert d["deadlineTier"] == "extended" and d["deadlineChangeConfirmed"]
    assert d["tiiChecks"] == [{"date": "2026-07-01", "aiPercent": 30}]
    assert d["wrappedUpAt"].startswith("2026-08-01") and d["defenseConfirmed"]
    assert d["milestones"] == {"form1": "completed"}
    assert d["saHoursTotal"] == 12
    assert {s["attempt"] for s in d["sessions"]} == {1}
    assert d["saHoursUsed"] == 3   # 2 节老 SA + resit 期间那节，答辩不算


def test_undo_without_resit_is_conflict(client, tutor, student):
    r = client.delete(f"/api/students/{student.id}/resit", headers=_hdr(tutor))
    assert r.status_code == 409


@pytest.mark.parametrize("body,detail", [
    ({"round": ""}, "轮次"),
    ({"round": "26春"}, "相同"),
    ({"saHoursTotal": -1}, "负"),
    ({"saHoursTotal": "abc"}, "整数"),
])
def test_start_validation(client, tutor, student, body, detail):
    r = _start(client, tutor, student.id, **body)
    assert r.status_code == 422 and detail in r.json()["detail"]


def test_second_resit_stacks(client, tutor, student):
    _start(client, tutor, student.id)
    d = _start(client, tutor, student.id, round="27春").json()
    assert d["currentAttempt"] == 3
    assert d["previousRounds"] == ["26春", "26秋"]
