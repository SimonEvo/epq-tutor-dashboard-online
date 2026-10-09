"""越权回归测试：B 账号不能看见、也不能改动 A 账号的任何数据。

P1 把租户过滤加到了九张表和十几个 router 上。这个测试存在的理由是
"漏改一处就是一个泄漏点" —— 它不挑端点，而是**遍历全部无路径参数的 GET
端点**，断言 A 的任何一个 id 都不出现在 B 的响应里。新加 router 若忘了
过滤，会在这里掉下来，而不是上线后被内测老师发现。

另外单独覆盖按 id 的写端点（拿 A 的 id 去改/删）和 admin 限定端点。
"""
import re
import uuid

import pytest
from fastapi.testclient import TestClient

from app import models
from app.auth import hash_password, token_for
from app.database import SessionLocal
from app.main import app, run_migrations


# ── 夹具 ──────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    run_migrations()
    s = SessionLocal()
    yield s
    s.close()


def _new_tutor(db, username: str, role: str) -> models.Tutor:
    t = models.Tutor(
        id=str(uuid.uuid4()), username=username,
        password_hash=hash_password("x"), role=role,
        ics_token=uuid.uuid4().hex,
    )
    db.add(t)
    db.commit()
    return t


def _seed(db, tutor: models.Tutor, mark: str) -> dict[str, str]:
    """给一个租户塞满各类数据，返回 {实体名: id}。id 里带 mark 便于在响应里比对。"""
    ids: dict[str, str] = {}

    def nid(kind: str) -> str:
        v = f"{mark}-{kind}-{uuid.uuid4().hex[:8]}"
        ids[kind] = v
        return v

    sup = models.Supervisor(id=nid("supervisor"), tutor_id=tutor.id, name=f"{mark}督导")
    stu = models.Student(
        id=nid("student"), tutor_id=tutor.id, name=f"{mark}学生",
        topic=f"{mark}-topic", supervisor_id=sup.id, submission_round="26春",
        private_notes=f"{mark}-私密笔记",
    )
    db.add_all([
        sup, stu,
        models.Session(id=nid("session"), student_id=stu.id, type="SA_MEETING",
                       date="2026-09-01", time="10:00"),
        models.PersonalEntry(id=nid("personal_entry"), student_id=stu.id, date="2026-09-01",
                             title=f"{mark}日志", content="x", created_at="2026-09-01"),
        models.MindMap(id=nid("mind_map"), student_id=stu.id, date="2026-09-01",
                       title=f"{mark}导图", content="x", created_at="2026-09-01"),
        models.HomeworkEntry(id=nid("homework"), student_id=stu.id, date="2026-09-01",
                             source_label=f"{mark}作业", created_at="2026-09-01"),
        models.StudentKnowledgeEntry(id=nid("kb_entry"), student_id=stu.id,
                                     content=f"{mark}-知识条目"),
        models.Trial(id=nid("trial"), tutor_id=tutor.id, date="2026-09-02",
                     time="14:00", student_name=f"{mark}试听生"),
        models.ScheduleEvent(id=nid("schedule_event"), tutor_id=tutor.id,
                             title=f"{mark}会议", date="2026-09-03", time="09:00"),
        models.GroupClass(id=nid("group_class"), tutor_id=tutor.id, title=f"{mark}团课",
                          date="2026-09-04", time="19:00", duration_minutes=60),
        models.Tag(name=f"{mark}标签", tutor_id=tutor.id),
        models.ManualLog(id=nid("manual_log"), tutor_id=tutor.id,
                         occurred_at=__import__("datetime").datetime(2026, 9, 1),
                         description=f"{mark}-手工日志"),
        models.GanttProject(id=nid("gantt"), tutor_id=tutor.id, owner_type="tutor",
                            name=f"{mark}甘特"),
        models.WeeklyReport(tutor_id=tutor.id, generated_at="2026-09-01",
                            content=f"{mark}-周报正文", last_scan_at="2026-09-01"),
    ])
    db.commit()
    return ids


@pytest.fixture(scope="module")
def world(db):
    a = _new_tutor(db, "alice-admin", "admin")
    b = _new_tutor(db, "bob-tutor", "tutor")
    a_ids = _seed(db, a, "AAA")
    b_ids = _seed(db, b, "BBB")
    return {
        "a": a, "b": b, "a_ids": a_ids, "b_ids": b_ids,
        "a_token": token_for(a),
        "b_token": token_for(b),
    }


@pytest.fixture(scope="module")
def client():
    # 不用 with：那会跑 lifespan，把后台推送循环也起起来。
    return TestClient(app)


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── 1. 列表端点全扫：B 的响应里不得出现 A 的任何 id ────────────────────────────

def _plain_get_paths() -> list[str]:
    out = []
    for r in app.routes:
        path = getattr(r, "path", "")
        methods = getattr(r, "methods", set()) or set()
        if "GET" not in methods or "{" in path:
            continue
        if path in {"/health", "/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}:
            continue
        out.append(path)
    return sorted(out)


def test_list_endpoints_leak_nothing(client, world):
    a_values = set(world["a_ids"].values()) | {"AAA-topic", "AAA-私密笔记", "AAA-周报正文"}
    leaks = []
    for path in _plain_get_paths():
        resp = client.get(path, headers=_hdr(world["b_token"]))
        if resp.status_code != 200:
            continue
        body = resp.text
        for v in a_values:
            if v in body:
                leaks.append(f"{path} 泄漏了 {v}")
    assert not leaks, "跨租户泄漏：\n" + "\n".join(leaks)


def test_every_list_endpoint_was_actually_reachable(client, world):
    """防止上一个测试因为端点全部 4xx 而空转通过。"""
    ok = [p for p in _plain_get_paths()
          if client.get(p, headers=_hdr(world["b_token"])).status_code == 200]
    assert len(ok) >= 8, f"可达的列表端点太少（{len(ok)}），上面的扫描形同虚设"


# ── 2. 按 id 的读写端点：拿 A 的 id 去操作，必须失败 ──────────────────────────

def _student_scoped_routes() -> list[tuple[str, str]]:
    """全部只以 student_id 为唯一路径参数的端点。

    写成自动枚举而不是手工清单：以后新增 /api/students/{student_id}/xxx
    会自动纳入覆盖，不需要有人记得回来补测试。
    """
    out = []
    for r in app.routes:
        path = getattr(r, "path", "")
        params = re.findall(r"{(\w+)}", path)
        if params != ["student_id"]:
            continue
        for m in sorted(getattr(r, "methods", set()) or set()):
            if m in ("HEAD", "OPTIONS"):
                continue
            out.append((m, path))
    return sorted(out)


@pytest.mark.parametrize("method,path_template", _student_scoped_routes())
def test_student_scoped_routes_reject_other_tenant(client, world, method, path_template):
    path = path_template.replace("{student_id}", world["a_ids"]["student"])
    resp = client.request(method, path, json={}, headers=_hdr(world["b_token"]))
    # 422 只对带 body 的方法放行：空 body 过不了校验，属于在所有权检查之前就被挡下。
    allowed = {403, 404} | ({422} if method in ("PUT", "PATCH", "POST") else set())
    assert resp.status_code in allowed, (
        f"{method} {path} 返回 {resp.status_code}，B 不应能操作 A 的学生"
    )


def test_student_scoped_route_sweep_is_not_empty():
    assert len(_student_scoped_routes()) >= 8, "学生端点枚举为空，上面的参数化形同虚设"


@pytest.mark.parametrize("method,template,kind", [
    ("DELETE", "/api/supervisors/{supervisor}", "supervisor"),
    ("DELETE", "/api/trials/{trial}", "trial"),
    ("PUT",    "/api/trials/{trial}", "trial"),
    ("DELETE", "/api/schedule-events/{schedule_event}", "schedule_event"),
    ("DELETE", "/api/group-classes/{group_class}", "group_class"),
])
def test_by_id_endpoints_reject_other_tenant(client, world, method, template, kind):
    path = template.format(**{kind: world["a_ids"][kind]})
    resp = client.request(method, path, json={}, headers=_hdr(world["b_token"]))
    allowed = {403, 404} | ({422} if method in ("PUT", "PATCH", "POST") else set())
    assert resp.status_code in allowed, (
        f"{method} {path} 返回 {resp.status_code}，B 不应能操作 A 的{kind}"
    )


def test_cannot_overwrite_other_tenants_student(client, world, db):
    """更新路径曾经不带 tutor 过滤 —— 用别人的学生 id 发 PUT 能覆写别人的记录。"""
    sid = world["a_ids"]["student"]
    payload = {
        "id": sid, "name": "被B改掉了", "topic": "hijacked",
        "milestones": {}, "tags": [], "sessions": [],
        "personalEntries": [], "mindMaps": [], "homeworkEntries": [],
        "scheduleEntries": [],
    }
    resp = client.put(f"/api/students/{sid}", json=payload, headers=_hdr(world["b_token"]))
    db.expire_all()
    victim = db.get(models.Student, sid)
    assert victim.name != "被B改掉了", f"A 的学生被 B 覆写了（HTTP {resp.status_code}）"


def test_cannot_attach_other_tenants_supervisor(client, world):
    """把别人的 supervisor_id 写进自己的学生 = 一条跨租户读取旁路。"""
    payload = {
        "id": world["b_ids"]["student"], "name": "B的学生", "topic": "t",
        "supervisorId": world["a_ids"]["supervisor"],
        "milestones": {}, "tags": [], "sessions": [],
        "personalEntries": [], "mindMaps": [], "homeworkEntries": [],
        "scheduleEntries": [],
    }
    resp = client.put(f"/api/students/{world['b_ids']['student']}",
                      json=payload, headers=_hdr(world["b_token"]))
    assert resp.status_code == 422, f"应拒绝跨租户督导，实际 {resp.status_code}"


# ── 3. 备份：各备各的，恢复不能跨租户 ────────────────────────────────────────

def test_backup_snapshot_contains_only_own_data(client, world):
    resp = client.get("/api/backup/download", headers=_hdr(world["b_token"]))
    assert resp.status_code == 200
    for v in world["a_ids"].values():
        assert v not in resp.text, f"备份快照里出现了 A 的 {v}"


def test_backup_list_is_per_tenant(client, world):
    client.post("/api/backup/export", headers=_hdr(world["a_token"]))
    resp = client.get("/api/backup/list", headers=_hdr(world["b_token"]))
    assert resp.status_code == 200
    assert resp.json() == [], "B 看得见 A 的备份"


# ── 4. 全局配置写入仅 admin ──────────────────────────────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("PUT",  "/api/config/rounds", ["26春"]),
    ("POST", "/api/config/rounds/26春/archive", None),
    ("POST", "/api/config/rounds/26春/unarchive", None),
    ("PUT",  "/api/rounds/26春/deadlines", {"normal": "2026-08-07T17:00"}),
])
def test_global_config_writes_require_admin(client, world, method, path, body):
    resp = client.request(method, path, json=body, headers=_hdr(world["b_token"]))
    assert resp.status_code == 403, f"{method} {path} 对普通导师返回了 {resp.status_code}"

    resp = client.request(method, path, json=body, headers=_hdr(world["a_token"]))
    assert resp.status_code < 400, f"{method} {path} 对 admin 返回了 {resp.status_code}"


# ── 5. 日历：公开 ICS 按 token 分租户 ────────────────────────────────────────

def test_ics_is_per_tenant(client, world):
    client.put("/api/calendar", json={"ics": "AAA-CALENDAR"}, headers=_hdr(world["a_token"]))
    client.put("/api/calendar", json={"ics": "BBB-CALENDAR"}, headers=_hdr(world["b_token"]))

    b_url = client.get("/api/calendar/subscription", headers=_hdr(world["b_token"])).json()["url"]
    assert client.get(b_url).text == "BBB-CALENDAR"

    a_url = client.get("/api/calendar/subscription", headers=_hdr(world["a_token"])).json()["url"]
    assert a_url != b_url
    assert client.get(a_url).text == "AAA-CALENDAR"
    assert client.get("/api/calendar/不存在的token.ics").status_code == 404


# ── 6. scoped() 守卫：新表忘了加 tutor_id 要当场炸 ───────────────────────────

def test_scoped_rejects_unscoped_model(db, world):
    from app.scoping import scoped
    with pytest.raises(ValueError):
        scoped(db, models.Round, world["a"])        # 全局表
    with pytest.raises(ValueError):
        scoped(db, models.Session, world["a"])      # 经 student_id 归属
