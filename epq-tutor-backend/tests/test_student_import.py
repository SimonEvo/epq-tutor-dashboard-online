"""学生批量导入：匹配、diff、落库。"""
import uuid

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
def ctx(db):
    tutor = models.Tutor(id=str(uuid.uuid4()), username=f"imp-{uuid.uuid4().hex[:6]}",
                         password_hash=hash_password("x"), role="tutor")
    db.add(tutor)
    db.flush()
    sup = models.Supervisor(id=str(uuid.uuid4()), tutor_id=tutor.id, name="Nelly")
    existing = models.Student(
        id=str(uuid.uuid4()), tutor_id=tutor.id, name="章哲睿",
        school="旧学校", submission_round="26春", registration_round="26春",
        topic="old topic",
    )
    db.add_all([sup, existing])
    db.commit()
    return {"tutor": tutor, "sup": sup, "student": existing,
            "token": token_for(tutor)}


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def _hdr(ctx):
    return {"Authorization": f"Bearer {ctx['token']}"}


def _preview(client, ctx, rows):
    r = client.post("/api/students/import/preview", json={"rows": rows}, headers=_hdr(ctx))
    assert r.status_code == 200, r.text
    return r.json()


def test_new_student_is_categorised_as_new(client, ctx):
    res = _preview(client, ctx, [{"name": "全新同学", "school": "某中学"}])
    assert res["rows"][0]["category"] == "new"
    assert res["summary"]["new"] == 1


def test_existing_student_shows_field_diffs(client, ctx):
    res = _preview(client, ctx, [{"name": "章哲睿", "school": "新学校", "topic": "old topic"}])
    row = res["rows"][0]
    assert row["category"] == "update"
    assert row["matchedStudentId"] == ctx["student"].id
    changed = {d["field"]: (d["before"], d["after"]) for d in row["diffs"]}
    assert changed["school"] == ("旧学校", "新学校")
    assert "topic" not in changed, "值没变的字段不该出现在 diff 里"


def test_blank_cells_do_not_appear_as_changes(client, ctx):
    """规则 1：空单元格不覆盖已有数据。"""
    res = _preview(client, ctx, [{"name": "章哲睿", "school": "", "topic": None}])
    assert res["rows"][0]["diffs"] == []


def test_duplicate_rows_in_batch_are_conflicts(client, ctx):
    res = _preview(client, ctx, [{"name": "重名甲"}, {"name": "重名甲"}])
    assert res["rows"][0]["category"] == "new"
    assert res["rows"][1]["category"] == "conflict"
    assert "第 1 行" in res["rows"][1]["reason"]


def test_blank_name_is_conflict(client, ctx):
    res = _preview(client, ctx, [{"name": "   "}])
    assert res["rows"][0]["category"] == "conflict"


def test_one_year_marker_drives_rounds_and_cleans_name(client, ctx):
    res = _preview(client, ctx, [
        {"name": "周一（一年期）", "registrationRound": "25秋", "classBatch": "25秋一年期"},
    ])
    data = res["rows"][0]["data"]
    assert data["name"] == "周一"          # 标记不留在姓名里
    assert data["registrationRound"] == "25秋"
    assert data["submissionRound"] == "26春"
    assert data["isOneYear"] is True


def test_explicit_submission_round_wins_over_derivation(client, ctx):
    """延期学生：表里显式写了提交轮次就照它来，不被推导覆盖。"""
    res = _preview(client, ctx, [
        {"name": "延期同学", "registrationRound": "25秋", "submissionRound": "26秋"},
    ])
    data = res["rows"][0]["data"]
    assert data["registrationRound"] == "25秋"
    assert data["submissionRound"] == "26秋"


def test_long_form_round_label_is_normalised(client, ctx):
    """教务导出的 `25秋季（26年3月提交）` 直接导入，归一为短格式。"""
    res = _preview(client, ctx, [
        {"name": "教务来的", "registrationRound": "25秋季（26年3月提交）"},
    ])
    assert res["rows"][0]["data"]["registrationRound"] == "25秋"


def test_unknown_supervisor_warns_but_does_not_block(client, ctx):
    res = _preview(client, ctx, [{"name": "带督导的", "supervisorName": "查无此人"}])
    row = res["rows"][0]
    assert row["category"] == "new"
    assert row["supervisorId"] is None
    assert "不在名单" in row["supervisorWarning"]


def test_known_supervisor_resolves(client, ctx):
    res = _preview(client, ctx, [{"name": "带督导的2", "supervisorName": "nelly"}])
    assert res["rows"][0]["supervisorId"] == ctx["sup"].id


def test_apply_creates_updates_and_skips(client, ctx, db):
    payload = {"rows": [
        {"action": "create", "data": {"name": "导入新建甲", "school": "甲中",
                                      "registrationRound": "25秋", "isOneYear": True}},
        {"action": "update", "studentId": ctx["student"].id,
         "data": {"name": "章哲睿", "school": "更新后的学校"}},
        {"action": "skip", "data": {"name": "被跳过的"}},
    ]}
    r = client.post("/api/students/import/apply", json=payload, headers=_hdr(ctx))
    assert r.status_code == 200, r.text
    assert r.json() == {"created": 1, "updated": 1, "skipped": 1}

    db.expire_all()
    created = db.query(models.Student).filter(models.Student.name == "导入新建甲").one()
    assert created.tutor_id == ctx["tutor"].id
    assert (created.registration_round, created.submission_round) == ("25秋", "26春")
    assert created.is_one_year is True

    assert db.get(models.Student, ctx["student"].id).school == "更新后的学校"
    assert db.query(models.Student).filter(models.Student.name == "被跳过的").count() == 0


def test_apply_refuses_other_tenants_student(client, ctx, db):
    other = models.Tutor(id=str(uuid.uuid4()), username=f"other-{uuid.uuid4().hex[:6]}",
                         password_hash=hash_password("x"), role="tutor")
    db.add(other)
    db.flush()
    victim = models.Student(id=str(uuid.uuid4()), tutor_id=other.id, name="别人的学生")
    db.add(victim)
    db.commit()

    r = client.post("/api/students/import/apply", headers=_hdr(ctx), json={"rows": [
        {"action": "update", "studentId": victim.id, "data": {"name": "被改名"}},
    ]})
    assert r.status_code == 404
    db.expire_all()
    assert db.get(models.Student, victim.id).name == "别人的学生"
