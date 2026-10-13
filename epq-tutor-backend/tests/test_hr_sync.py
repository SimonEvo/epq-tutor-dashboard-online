"""教务同步（ADR 0008），全部对着 tests/hr_mock.py 跑——教务一行不改。"""
import random
import uuid

import pytest
from fastapi.testclient import TestClient

from app import hr_sync, models
from app.auth import hash_password, token_for
from app.database import SessionLocal
from app.main import app, run_migrations
from app.routers.hr_sync import get_hr_session
from tests.hr_mock import PREFIX, MockState, create_mock_app

BASE = f"http://testserver{PREFIX}"


@pytest.fixture(scope="module")
def db():
    run_migrations()
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def world(db):
    """每个测试一套干净的：mock 教务、镜像、配置、两位导师 + 一位管理员。"""
    db.query(models.HrProject).delete()
    db.query(models.SystemConfig).filter(models.SystemConfig.key.like("hr_%")).delete(
        synchronize_session=False)
    db.commit()

    ids = random.sample(range(10_000, 900_000), 3)
    state = MockState()
    song = state.user(ids[0], "宋老师", "song@x.com")
    wang = state.user(ids[1], "王老师", "wang@x.com")
    state.user(ids[2], "赵助理")
    nelly = {"id": 7, "name": "Nelly", "email": "n@x.com"}

    state.add_project("C1", "章哲睿", student_email="zzr@x.com",
                      term_name="26春季（26年9月提交）", topic_confirmed="教务的课题",
                      members=[{"role": "SA", "user": song}], im_name="赵助理")
    state.add_project("C2", "林小满（一年期）", term_name="26春季（26年9月提交）",
                      members=[{"role": "TA", "user": song}, {"role": "SA", "sa_info": nelly}])
    state.add_project("C3", "陈一鸣", term_name="26秋季（27年3月提交）",
                      members=[{"role": "SA", "user": song}, {"role": "TA", "user": wang}])
    state.add_project("C4", "只归王老师", term_name="26秋季（27年3月提交）",
                      members=[{"role": "SA", "user": wang}])
    state.add_project("C5", "退出的学生", term_name="25秋季（26年3月提交）",
                      members=[{"role": "TA", "user": song}], is_exit=True)
    # 赵助理只以 IM 身份出现在 C1 —— 本系统不认 IM
    state.add_project("C6", "IM 学生", term_name="26春季（26年9月提交）", members=[],
                      im_name="赵助理")

    mock_client = TestClient(create_mock_app(state))
    app.dependency_overrides[get_hr_session] = lambda: mock_client

    def mk(role, hr_id=None):
        t = models.Tutor(id=str(uuid.uuid4()), username=f"{role}-{uuid.uuid4().hex[:6]}",
                         password_hash=hash_password("x"), role=role, status="active",
                         token_version=1, ics_token=uuid.uuid4().hex, hr_user_id=hr_id)
        db.add(t)
        db.commit()
        return t

    admin = mk("admin")
    t_song, t_wang = mk("tutor", ids[0]), mk("tutor", ids[1])
    client = TestClient(app)
    client.put("/api/admin/hr-config", headers=h(admin),
               json={"baseUrl": BASE, "token": state.token})
    yield {"state": state, "admin": admin, "song": t_song, "wang": t_wang,
           "client": client, "ids": ids}
    app.dependency_overrides.pop(get_hr_session, None)
    for t in (admin, t_song, t_wang):
        db.query(models.Student).filter(models.Student.tutor_id == t.id).delete()
        db.query(models.ActionLog).filter(models.ActionLog.tutor_id == t.id).delete()
        db.delete(db.get(models.Tutor, t.id))
    db.commit()


def h(t):
    return {"Authorization": f"Bearer {token_for(t)}"}


def preview(w, who="song"):
    r = w["client"].post("/api/hr-sync/preview", headers=h(w[who]))
    assert r.status_code == 200, r.text
    return r.json()


def rows_by_code(p):
    return {r["code"]: r for r in p["rows"]}


def apply(w, who, decisions):
    """和真实界面一样：先预览（会刷新镜像）再应用。字段只从镜像来，镜像空着就无从应用。"""
    preview(w, who)
    r = w["client"].post("/api/hr-sync/apply", headers=h(w[who]), json={"decisions": decisions})
    assert r.status_code == 200, r.text
    return r.json()


# ── 硬约束 ───────────────────────────────────────────────────────────────────

def test_never_calls_the_ack_endpoint(world, db):
    """教务的 ack 把 consumer 写死成在线表单系统，调了就挪别人的位点。"""
    w = world
    p = preview(w)
    decisions = [{"code": r["code"], "action": "create"} for r in p["rows"] if r["category"] == "new"]
    w["client"].post("/api/hr-sync/apply", headers=h(w["song"]), json={"decisions": decisions})
    w["client"].post("/api/admin/hr-sync/refresh", headers=h(w["admin"]))
    assert w["state"].ack_calls == [], "本系统调用了教务的 ack 端点"


def test_hr_client_has_no_ack_method():
    from app.hr_client import HrClient
    assert not any("ack" in name.lower() for name in dir(HrClient))


# ── 只拿分配给自己的 ─────────────────────────────────────────────────────────

def test_preview_contains_only_my_sa_and_mentor_projects(world):
    codes = set(rows_by_code(preview(world)))
    assert codes == {"C1", "C2", "C3", "C5"}, "宋老师的 SA/TA 项目之外的出现了"


def test_im_role_is_not_a_sync_role(world, db):
    """赵助理只做 IM —— 就算有人把他关联成导师，也不该拿到任何项目。"""
    w = world
    w["song"].hr_user_id = None
    db.commit()
    w["song"].hr_user_id = w["ids"][2]
    db.commit()
    assert preview(w)["rows"] == []


def test_two_tutors_on_one_project_each_get_their_own_copy(world, db):
    w = world
    for who in ("song", "wang"):
        apply(w, who, [{"code": "C3", "action": "create"}])
    copies = db.query(models.Student).filter(models.Student.hr_student_code == "C3").all()
    assert {c.tutor_id for c in copies} == {w["song"].id, w["wang"].id}


def test_cannot_apply_project_not_assigned_to_me(world):
    w = world
    preview(w)          # 镜像里有 C4，只是它属于王老师
    r = w["client"].post("/api/hr-sync/apply", headers=h(w["song"]),
                         json={"decisions": [{"code": "C4", "action": "create"}]})
    assert r.status_code == 403


def test_unlinked_tutor_gets_clear_409(world, db):
    w = world
    w["song"].hr_user_id = None
    db.commit()
    r = w["client"].post("/api/hr-sync/preview", headers=h(w["song"]))
    assert r.status_code == 409 and "管理员" in r.json()["detail"]


# ── 字段归属 ─────────────────────────────────────────────────────────────────

def test_new_student_gets_hr_fields(world, db):
    w = world
    apply(w, "song", [{"code": "C2", "action": "create"}])
    s = db.query(models.Student).filter(models.Student.tutor_id == w["song"].id,
                                        models.Student.hr_student_code == "C2").one()
    assert s.name == "林小满", "一年期标记应从姓名剥掉"
    assert s.is_one_year is True, "剥掉的标记必须转存成 is_one_year"
    assert s.submission_round == "26春", "长格式学期要归一"


def test_tutor_owned_topic_is_never_overwritten(world, db):
    w = world
    local = models.Student(id=str(uuid.uuid4()), tutor_id=w["song"].id, name="章哲睿",
                           topic="导师自己写的英文课题", hr_student_code="C1",
                           submission_round="25秋")
    db.add(local)
    db.commit()
    row = rows_by_code(preview(w))["C1"]
    changed = {d["field"] for d in row["diffs"]}
    assert "topic" not in changed, "课题是导师的字段，不该被教务覆盖"
    assert "submission_round" in changed, "提交轮次是教务权威字段，应该覆盖"


def test_round_change_from_hr_clears_old_deadline(world, db):
    w = world
    local = models.Student(id=str(uuid.uuid4()), tutor_id=w["song"].id, name="章哲睿",
                           topic="t", hr_student_code="C1", submission_round="25秋",
                           deadline_tier="extended", deadline_override="2026-03-13T17:00",
                           deadline_change_confirmed=True)
    db.add(local)
    db.commit()
    apply(w, "song", [{"code": "C1", "action": "update", "studentId": local.id}])
    db.expire_all()
    s = db.get(models.Student, local.id)
    assert s.submission_round == "26春"
    assert (s.deadline_tier, s.deadline_override, s.deadline_change_confirmed) == ("normal", None, False)


def test_exited_student_is_flagged_not_deleted(world, db):
    w = world
    apply(w, "song", [{"code": "C5", "action": "create"}])
    w["state"].update_project("C5", is_exit=True)
    row = rows_by_code(preview(w))["C5"]
    assert row["exited"] is True
    assert db.query(models.Student).filter(models.Student.hr_student_code == "C5").count() == 1


# ── 认领存量学生 ─────────────────────────────────────────────────────────────

def test_existing_student_is_offered_for_linking_by_name(world, db):
    w = world
    local = models.Student(id=str(uuid.uuid4()), tutor_id=w["song"].id, name="陈一鸣", topic="")
    db.add(local)
    db.commit()
    row = rows_by_code(preview(w))["C3"]
    assert row["category"] == "link" and row["matchedStudentId"] == local.id

    r = w["client"].post("/api/hr-sync/apply", headers=h(w["song"]), json={"decisions": [
        {"code": "C3", "action": "link", "studentId": local.id}]})
    assert r.json()["linked"] == 1
    db.expire_all()
    assert db.get(models.Student, local.id).hr_student_code == "C3"
    assert rows_by_code(preview(w))["C3"]["category"] == "update", "关联后应按编号匹配"


def test_ambiguous_name_is_a_conflict(world, db):
    w = world
    for _ in range(2):
        db.add(models.Student(id=str(uuid.uuid4()), tutor_id=w["song"].id, name="陈一鸣", topic=""))
    db.commit()
    assert rows_by_code(preview(w))["C3"]["category"] == "conflict"


def test_no_longer_assigned_student_shows_as_orphan(world, db):
    w = world
    db.add(models.Student(id=str(uuid.uuid4()), tutor_id=w["song"].id, name="旧学生",
                          topic="", hr_student_code="GONE"))
    db.commit()
    assert [o["code"] for o in preview(w)["orphans"]] == ["GONE"]


# ── 镜像刷新 ─────────────────────────────────────────────────────────────────

def test_refresh_is_incremental(world):
    w, st = world, world["state"]
    w["client"].post("/api/admin/hr-sync/refresh", headers=h(w["admin"]))
    first = len(st.detail_calls)
    assert first == 6

    w["client"].post("/api/admin/hr-sync/refresh", headers=h(w["admin"]))
    assert len(st.detail_calls) == first, "没有变化时不该再拉详情"

    st.update_project("C1", topic_confirmed="改了")
    w["client"].post("/api/admin/hr-sync/refresh", headers=h(w["admin"]))
    assert st.detail_calls[first:] == ["C1"], "只该重拉变了的那个"


def test_tutor_refresh_respects_cooldown(world):
    w, st = world, world["state"]
    preview(w)
    calls = st.change_feed_calls
    preview(w)
    assert st.change_feed_calls == calls, "冷却期内导师再点同步不该再打教务"


def test_preview_survives_hr_outage(world, db):
    w = world
    w["client"].post("/api/admin/hr-sync/refresh", headers=h(w["admin"]))
    db.query(models.SystemConfig).filter(models.SystemConfig.key == hr_sync.KEY_LAST_REFRESH).delete()
    db.commit()
    w["client"].put("/api/admin/hr-config", headers=h(w["admin"]), json={"token": "wrong"})
    p = preview(w)
    assert p["warning"], "教务连不上时应告诉导师"
    assert p["rows"], "但仍应用上次的镜像出预览"


# ── 管理面 ───────────────────────────────────────────────────────────────────

def test_hr_config_is_admin_only_and_token_masked(world):
    w = world
    assert w["client"].get("/api/admin/hr-config", headers=h(w["song"])).status_code == 403
    body = w["client"].get("/api/admin/hr-config", headers=h(w["admin"]))
    assert w["state"].token not in body.text
    assert body.json()["configured"] is True


def test_people_list_excludes_synthetic_ids(world):
    w = world
    w["client"].post("/api/admin/hr-sync/refresh", headers=h(w["admin"]))
    people = w["client"].get("/api/admin/hr-people", headers=h(w["admin"])).json()
    ids = {p["hrUserId"] for p in people}
    assert ids == {w["ids"][0], w["ids"][1]}, f"合成 id 或 IM 混进了可关联名单：{ids}"


@pytest.mark.parametrize("bad,code", [(1_000_007, 422), (2_000_001, 422)])
def test_cannot_link_synthetic_ids(world, bad, code):
    w = world
    r = w["client"].patch(f"/api/admin/tutors/{w['wang'].id}", headers=h(w["admin"]),
                          json={"hrUserId": bad})
    assert r.status_code == code


def test_one_hr_account_links_to_one_tutor(world):
    w = world
    r = w["client"].patch(f"/api/admin/tutors/{w['wang'].id}", headers=h(w["admin"]),
                          json={"hrUserId": w["ids"][0]})
    assert r.status_code == 409
    assert w["song"].username in r.json()["detail"], "报错要说清楚被谁占了"


def test_link_can_be_removed(world, db):
    w = world
    r = w["client"].patch(f"/api/admin/tutors/{w['wang'].id}", headers=h(w["admin"]),
                          json={"hrUserId": 0})
    assert r.status_code == 200 and r.json()["hrUserId"] is None
