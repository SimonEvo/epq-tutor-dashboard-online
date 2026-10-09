"""机构共享 AI 凭据（P3 方案 B）。

三条要守住的：
  - key 明文永不回传客户端
  - 请求体里带 apiKey 一律不认（认了就能绕过用量统计）
  - 每次 AI 调用都按人记一笔
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app import ai_config, models
from app.auth import hash_password, token_for
from app.database import SessionLocal
from app.main import app, run_migrations

REAL_KEY = "sk-super-secret-value-9zZq"


@pytest.fixture(scope="module")
def db():
    run_migrations()
    s = SessionLocal()
    yield s
    s.close()


def _mk(db, role):
    t = models.Tutor(id=str(uuid.uuid4()), username=f"{role}-{uuid.uuid4().hex[:6]}",
                     password_hash=hash_password("x"), role=role, status="active",
                     token_version=1, ics_token=uuid.uuid4().hex)
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


def h(t):
    return {"Authorization": f"Bearer {token_for(t)}"}


@pytest.fixture(autouse=True)
def _clear_config(db):
    db.query(models.SystemConfig).delete()
    db.commit()
    yield


# ── 权限 ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method,body", [("GET", None), ("PUT", {"apiKey": "x"})])
def test_ai_config_is_admin_only(client, plain, method, body):
    r = client.request(method, "/api/admin/ai-config", json=body, headers=h(plain))
    assert r.status_code == 403


# ── key 不回传 ───────────────────────────────────────────────────────────────

def test_key_is_never_returned_in_plaintext(client, admin):
    put = client.put("/api/admin/ai-config", headers=h(admin),
                     json={"apiKey": REAL_KEY, "model": "deepseek-v4-flash"})
    assert put.status_code == 200
    assert REAL_KEY not in put.text, "PUT 的响应里出现了 key 明文"

    got = client.get("/api/admin/ai-config", headers=h(admin))
    assert REAL_KEY not in got.text, "GET 的响应里出现了 key 明文"
    body = got.json()
    assert body["configured"] is True
    assert body["keyHint"] == "••••9zZq"       # 只露末四位，够确认换对了没
    assert "apiKey" not in body


def test_unconfigured_state_has_sane_defaults(client, admin):
    body = client.get("/api/admin/ai-config", headers=h(admin)).json()
    assert body["configured"] is False
    assert body["keyHint"] == ""
    assert body["baseUrl"] == ai_config.DEFAULT_BASE_URL
    assert body["model"] == ai_config.DEFAULT_MODEL


def test_partial_update_leaves_other_fields_alone(client, admin):
    client.put("/api/admin/ai-config", headers=h(admin),
               json={"apiKey": REAL_KEY, "model": "m1", "baseUrl": "https://a/v1"})
    client.put("/api/admin/ai-config", headers=h(admin), json={"model": "m2"})
    body = client.get("/api/admin/ai-config", headers=h(admin)).json()
    assert body["model"] == "m2"
    assert body["baseUrl"] == "https://a/v1"
    assert body["configured"] is True, "只改模型不该把 key 清掉"


def test_key_can_be_cleared_explicitly(client, admin):
    client.put("/api/admin/ai-config", headers=h(admin), json={"apiKey": REAL_KEY})
    client.put("/api/admin/ai-config", headers=h(admin), json={"apiKey": ""})
    assert client.get("/api/admin/ai-config", headers=h(admin)).json()["configured"] is False


# ── 导师侧只读状态 ───────────────────────────────────────────────────────────

def test_status_endpoint_gives_tutors_no_credentials(client, admin, plain):
    client.put("/api/admin/ai-config", headers=h(admin),
               json={"apiKey": REAL_KEY, "baseUrl": "https://secret-endpoint/v1"})
    r = client.get("/api/ai/status", headers=h(plain))
    assert r.status_code == 200
    assert set(r.json()) == {"configured", "model"}
    assert REAL_KEY not in r.text
    assert "secret-endpoint" not in r.text, "baseUrl 也不该给导师"


# ── 未配置时的报错 ───────────────────────────────────────────────────────────

def test_ai_call_without_config_returns_503_with_guidance(client, plain):
    r = client.post("/api/ai/proxy", headers=h(plain), json={"prompt": "hi"})
    assert r.status_code == 503
    assert "管理员" in r.json()["detail"], "报错要告诉导师该找谁"


def test_client_supplied_key_is_ignored(client, plain):
    """请求体里塞 key 不能起作用 —— 否则用量统计形同虚设。"""
    r = client.post("/api/ai/proxy", headers=h(plain),
                    json={"prompt": "hi", "apiKey": "sk-client-side-key",
                          "model": "gpt-4", "baseUrl": "https://evil/v1"})
    assert r.status_code == 503, "服务端没配 key 时，客户端传的 key 不该被采用"


# ── 用量记账 ─────────────────────────────────────────────────────────────────

def test_successful_call_is_recorded_per_tutor(client, admin, plain, db, monkeypatch):
    from app.routers import ai as ai_router
    client.put("/api/admin/ai-config", headers=h(admin), json={"apiKey": REAL_KEY})

    seen = {}

    def fake_provider(messages, api_key, model, base_url, max_tokens):
        seen.update(api_key=api_key, model=model, base_url=base_url)
        return "生成的内容"

    monkeypatch.setattr(ai_router, "_call_provider", fake_provider)

    before = db.query(models.ActionLog).filter(
        models.ActionLog.tutor_id == plain.id,
        models.ActionLog.action == "ai_generate",
    ).count()

    r = client.post("/api/ai/proxy", headers=h(plain), json={"prompt": "写个报告"})
    assert r.status_code == 200 and r.json()["content"] == "生成的内容"
    # 用的是服务端凭据，不是客户端传的
    assert seen["api_key"] == REAL_KEY

    after = db.query(models.ActionLog).filter(
        models.ActionLog.tutor_id == plain.id,
        models.ActionLog.action == "ai_generate",
    ).count()
    assert after == before + 1, "AI 调用没被记进用量"


def test_usage_shows_up_in_admin_panel(client, admin, plain, db, monkeypatch):
    from app.routers import ai as ai_router
    client.put("/api/admin/ai-config", headers=h(admin), json={"apiKey": REAL_KEY})
    monkeypatch.setattr(ai_router, "_call_provider", lambda *a, **k: "ok")

    client.post("/api/ai/proxy", headers=h(plain), json={"prompt": "x"})
    rows = client.get("/api/admin/tutors", headers=h(admin)).json()
    row = next(r for r in rows if r["id"] == plain.id)
    assert row["aiCallCount"] >= 1


def test_report_save_does_not_double_count(client, admin, plain, db, monkeypatch):
    """一次生成只算一次。

    ai.py 在调 provider 时记 entity_type='ai_call'，而 students.py / reports.py
    在报告落库时也记一笔 action='ai_generate'。管理面若两者都算，用量会翻倍。
    """
    from app.routers import ai as ai_router
    client.put("/api/admin/ai-config", headers=h(admin), json={"apiKey": REAL_KEY})
    monkeypatch.setattr(ai_router, "_call_provider", lambda *a, **k: "ok")

    def count() -> int:
        rows = client.get("/api/admin/tutors", headers=h(admin)).json()
        return next(r for r in rows if r["id"] == plain.id)["aiCallCount"]

    before = count()
    client.post("/api/ai/proxy", headers=h(plain), json={"prompt": "x"})
    # 模拟报告落库那一笔日志
    db.add(models.ActionLog(tutor_id=plain.id, action="ai_generate",
                            entity_type="session_report", entity_id="s1"))
    db.commit()

    assert count() == before + 1, "报告落库的那笔日志被重复计入了用量"
