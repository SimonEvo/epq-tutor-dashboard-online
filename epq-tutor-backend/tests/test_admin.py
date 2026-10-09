"""账号管理与会话失效。

重点不只是「功能能用」，还有两条约束：
  - 停用 / 重置密码必须让已签发的令牌**当场**失效（否则对方还能用满 7 天）
  - admin 拿不到别人的业务数据（ADR 0004 决策 5）
"""
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


def _mk(db, role: str, password: str = "correct-horse") -> models.Tutor:
    t = models.Tutor(
        id=str(uuid.uuid4()), username=f"{role}-{uuid.uuid4().hex[:6]}",
        password_hash=hash_password(password), role=role, status="active",
        token_version=1, ics_token=uuid.uuid4().hex,
    )
    db.add(t)
    db.commit()
    return t


@pytest.fixture(scope="module")
def admin(db):
    return _mk(db, "admin")


@pytest.fixture(scope="module")
def plain(db):
    return _mk(db, "tutor")


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def h(t: models.Tutor) -> dict:
    return {"Authorization": f"Bearer {token_for(t)}"}


# ── 权限 ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,path,body", [
    ("GET", "", None),
    ("POST", "", {"username": "x1", "password": "password123"}),
    ("PATCH", "/someone", {"displayName": "x"}),
    ("POST", "/someone/reset-password", {"password": "password123"}),
])
def test_admin_endpoints_reject_plain_tutor(client, plain, method, path, body):
    r = client.request(method, f"/api/admin/tutors{path}", json=body, headers=h(plain))
    assert r.status_code == 403, f"{method} {path} 返回 {r.status_code}"


def test_me_reports_role(client, admin, plain):
    assert client.get("/auth/me", headers=h(admin)).json()["role"] == "admin"
    assert client.get("/auth/me", headers=h(plain)).json()["role"] == "tutor"


# ── 建号 ─────────────────────────────────────────────────────────────────────

def test_create_account_and_login(client, admin, db):
    name = f"beta-{uuid.uuid4().hex[:6]}"
    r = client.post("/api/admin/tutors", headers=h(admin),
                    json={"username": name, "password": "password123", "displayName": "内测老师"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "tutor" and body["status"] == "active"
    assert body["studentCount"] == 0

    login = client.post("/auth/login", json={"username": name, "password": "password123"})
    assert login.status_code == 200
    assert login.json()["role"] == "tutor"

    db.expire_all()
    created = db.query(models.Tutor).filter(models.Tutor.username == name).one()
    assert created.ics_token, "新账号必须有自己的日历 token"
    assert created.last_login_at is not None


def test_duplicate_username_rejected(client, admin):
    name = f"dup-{uuid.uuid4().hex[:6]}"
    first = client.post("/api/admin/tutors", headers=h(admin),
                        json={"username": name, "password": "password123"})
    assert first.status_code == 201
    again = client.post("/api/admin/tutors", headers=h(admin),
                        json={"username": name, "password": "password123"})
    assert again.status_code == 409


def test_short_password_rejected(client, admin):
    r = client.post("/api/admin/tutors", headers=h(admin),
                    json={"username": f"weak-{uuid.uuid4().hex[:6]}", "password": "short"})
    assert r.status_code == 422


# ── 停用：旧令牌必须当场失效 ─────────────────────────────────────────────────

def test_disabling_invalidates_existing_token(client, admin, db):
    victim = _mk(db, "tutor")
    old_token = {"Authorization": f"Bearer {token_for(victim)}"}
    assert client.get("/api/students", headers=old_token).status_code == 200

    r = client.patch(f"/api/admin/tutors/{victim.id}", headers=h(admin), json={"status": "disabled"})
    assert r.status_code == 200 and r.json()["status"] == "disabled"

    assert client.get("/api/students", headers=old_token).status_code == 401, \
        "停用后旧令牌仍然可用 —— 等于没停用"

    login = client.post("/auth/login", json={"username": victim.username, "password": "correct-horse"})
    assert login.status_code == 403


def test_reenabling_restores_login(client, admin, db):
    t = _mk(db, "tutor")
    client.patch(f"/api/admin/tutors/{t.id}", headers=h(admin), json={"status": "disabled"})
    client.patch(f"/api/admin/tutors/{t.id}", headers=h(admin), json={"status": "active"})
    login = client.post("/auth/login", json={"username": t.username, "password": "correct-horse"})
    assert login.status_code == 200


# ── 重置密码：旧令牌同样失效 ─────────────────────────────────────────────────

def test_reset_password_invalidates_old_token(client, admin, db):
    t = _mk(db, "tutor")
    old_token = {"Authorization": f"Bearer {token_for(t)}"}
    assert client.get("/api/students", headers=old_token).status_code == 200

    r = client.post(f"/api/admin/tutors/{t.id}/reset-password", headers=h(admin),
                    json={"password": "brand-new-pass"})
    assert r.status_code == 200

    assert client.get("/api/students", headers=old_token).status_code == 401, \
        "改密码后旧令牌仍然可用 —— 挡不住已经登录的人"
    assert client.post("/auth/login",
                       json={"username": t.username, "password": "correct-horse"}).status_code == 401
    assert client.post("/auth/login",
                       json={"username": t.username, "password": "brand-new-pass"}).status_code == 200


# ── 自锁防护 ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("body", [{"role": "tutor"}, {"status": "disabled"}])
def test_admin_cannot_lock_itself_out(client, admin, body):
    r = client.patch(f"/api/admin/tutors/{admin.id}", headers=h(admin), json=body)
    assert r.status_code == 422
    assert client.get("/api/admin/tutors", headers=h(admin)).status_code == 200


# ── 硬约束：admin 看不到别人的业务数据 ───────────────────────────────────────

def test_admin_surface_exposes_no_business_data(client, admin, plain, db):
    """admin 面板只给元数据。这条一旦破了，内测老师就没理由录真实信息。"""
    stu = models.Student(id=f"SECRET-{uuid.uuid4().hex[:8]}", tutor_id=plain.id,
                         name="别人的学生", topic="SECRET-TOPIC",
                         private_notes="SECRET-NOTE")
    db.add(stu)
    db.commit()

    for r in client.get("/api/admin/tutors", headers=h(admin)).json():
        assert set(r) == {
            "id", "username", "displayName", "role", "status",
            "createdAt", "lastLoginAt", "studentCount", "aiCallCount",
        }, f"管理面返回了计划外的字段：{sorted(r)}"

    # admin 自己的常规端点也不该看见别人的学生
    body = client.get("/api/students", headers=h(admin)).text
    for secret in (stu.id, "SECRET-TOPIC", "SECRET-NOTE"):
        assert secret not in body


def test_no_impersonation_endpoint_exists():
    """代登录是被明确否决的（ADR 0004 决策 5）。防止有人日后顺手加一个。"""
    suspicious = [
        r.path for r in app.routes
        if any(k in getattr(r, "path", "").lower()
               for k in ("impersonate", "switch-user", "act-as", "sudo", "login-as"))
    ]
    assert suspicious == [], f"出现了代登录端点：{suspicious}"
