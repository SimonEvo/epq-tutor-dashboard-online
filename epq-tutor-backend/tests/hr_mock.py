"""教务集成接口的本地复刻（mock）。

复刻对象：../hr-management/backend/app/api/routes/online_form_integration.py
（`/api/integrations/online-form/v1`）。响应形状、鉴权头、分配 id 的合成规则都
逐条照搬——这个 mock 的价值全在于"和真接口长得一样"，将来接通时才不会意外。

需要照搬的几处细节（都踩在 ADR 0008 的决策上）：
  - TA 在接口里叫 `MENTOR`，Process 不出现
  - 真实账号用 user.id；英方 SA（SAInfo）用 1_000_000 + sa_info_id；
    按 mentor_name 兜底的用 2_000_000 + project.id；IM 兜底用 3_000_000 + project.id
  - 每次项目变动 data_version 增大，变更序列追加一行
  - /sync-acknowledgements 把 consumer 写死成 EPQ_ONLINE_FORMS —— 本 mock 记录每次调用，
    测试据此断言本系统**从不调用它**

两种用法：
  - 测试里：`TestClient(create_mock_app())` 当作 HTTP session 传给 HrClient
  - 浏览器验证：`python -m tests.hr_mock --port 8098` 起一个带样例数据的服务
"""
from __future__ import annotations

import argparse
import hmac
from dataclasses import dataclass, field

from fastapi import FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

PREFIX = "/api/integrations/online-form/v1"
DEFAULT_TOKEN = "mock-service-token"


@dataclass
class MockProject:
    id: int
    student_code: str
    student_name: str
    student_email: str | None = None
    term_name: str | None = None          # academic_term.display_name，如「25秋季（26年3月提交）」
    term_code: str | None = None
    topic_confirmed: str | None = None
    topic_initial: str | None = None
    project_format: str | None = None
    is_exit: bool = False
    # 每项：{"role": "SA"|"TA"|"Process", "user": {...}} 或 {"role": "SA", "sa_info": {...}}
    members: list[dict] = field(default_factory=list)
    mentor_name: str | None = None
    im_name: str | None = None
    data_version: int = 1


@dataclass
class MockState:
    token: str = DEFAULT_TOKEN
    projects: dict[str, MockProject] = field(default_factory=dict)
    users_by_name: dict[str, dict] = field(default_factory=dict)
    changes: list[dict] = field(default_factory=list)   # [{sequence, event_type, student_code, data_version}]
    ack_calls: list[int] = field(default_factory=list)
    change_feed_calls: int = 0
    detail_calls: list[str] = field(default_factory=list)
    _next_id: int = 1

    # ── 造数据 ────────────────────────────────────────────────────────────
    def user(self, uid: int, name: str, email: str | None = None, active: bool = True) -> dict:
        u = {"id": uid, "name": name, "email": email, "status": "active" if active else "disabled"}
        self.users_by_name[name] = u
        return u

    def add_project(self, student_code: str, student_name: str, **kw) -> MockProject:
        p = MockProject(id=self._next_id, student_code=student_code, student_name=student_name, **kw)
        self._next_id += 1
        self.projects[student_code] = p
        self._log(p)
        return p

    def update_project(self, student_code: str, **changes) -> MockProject:
        p = self.projects[student_code]
        for k, v in changes.items():
            setattr(p, k, v)
        p.data_version += 1
        self._log(p)
        return p

    def _log(self, p: MockProject) -> None:
        self.changes.append({
            "sequence": len(self.changes) + 1,
            "event_type": "PROJECT_EXITED" if p.is_exit else "PROJECT_UPDATED",
            "student_code": p.student_code,
            "data_version": p.data_version,
        })


def _user_payload(user: dict | None, fallback_id: int, fallback_name: str | None = None,
                  fallback_email: str | None = None) -> dict | None:
    """照搬教务 user_payload()。"""
    if user:
        return {"id": user["id"], "name": user["name"], "email": user.get("email"),
                "is_active": user.get("status") == "active"}
    if fallback_name:
        return {"id": fallback_id, "name": fallback_name, "email": fallback_email, "is_active": True}
    return None


def _assignments(state: MockState, p: MockProject) -> list[dict]:
    """照搬教务 project_detail() 里拼 assignments 的逻辑，含合成 id 与兜底。"""
    out: list[dict] = []
    for idx, m in enumerate(p.members):
        if not m.get("is_active", True):
            continue
        role = {"TA": "MENTOR", "SA": "SA"}.get(m["role"])
        if not role:
            continue                                     # Process 等不出现
        sa_info = m.get("sa_info")
        member_id = m.get("member_id", 500 + idx)
        payload = _user_payload(
            m.get("user"),
            1_000_000 + (sa_info["id"] if sa_info else member_id),
            sa_info["name"] if sa_info else None,
            sa_info.get("email") if sa_info else None,
        )
        if payload:
            out.append({**payload, "role": role})

    if not any(a["role"] == "MENTOR" for a in out):
        mentor = state.users_by_name.get(p.mentor_name) if p.mentor_name else None
        payload = _user_payload(mentor, 2_000_000 + p.id, p.mentor_name)
        if payload:
            out.append({**payload, "role": "MENTOR"})

    im = state.users_by_name.get(p.im_name) if p.im_name else None
    im_payload = _user_payload(im, 3_000_000 + p.id, p.im_name)
    if im_payload:
        out.append({**im_payload, "role": "IM"})
    return out


class _Ack(BaseModel):
    through_sequence: int = Field(ge=0)


def create_mock_app(state: MockState | None = None) -> FastAPI:
    state = state or MockState()
    app = FastAPI(title="hr-management integration mock")
    app.state.hr = state

    def check(token: str | None) -> None:
        if not token or not hmac.compare_digest(token, state.token):
            raise HTTPException(status_code=401, detail="Invalid service token")

    @app.get(f"{PREFIX}/project-changes")
    def project_changes(
        after_sequence: int = Query(default=0, ge=0),
        limit: int = Query(default=200, ge=1, le=500),
        x_service_token: str | None = Header(default=None),
    ):
        check(x_service_token)
        state.change_feed_calls += 1
        rows = [c for c in state.changes if c["sequence"] > after_sequence][: limit + 1]
        has_more = len(rows) > limit
        rows = rows[:limit]
        return {"items": rows, "has_more": has_more,
                "next_cursor": rows[-1]["sequence"] if rows else None}

    @app.get(f"{PREFIX}/projects/{{student_code}}")
    def project_detail(student_code: str, x_service_token: str | None = Header(default=None)):
        check(x_service_token)
        state.detail_calls.append(student_code)
        p = state.projects.get(student_code)
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        return {
            "id": p.id,
            "student_code": p.student_code,
            "data_version": p.data_version,
            "student": {"id": -p.id, "name": p.student_name, "email": p.student_email,
                        "is_active": not p.is_exit},
            "academic_term": ({"id": 1, "code": p.term_code or "", "name": p.term_name}
                              if p.term_name else None),
            "title": p.topic_confirmed or p.topic_initial,
            "project_format": p.project_format,
            "is_exit": p.is_exit,
            "assignments": _assignments(state, p),
        }

    @app.post(f"{PREFIX}/sync-acknowledgements")
    def acknowledge(body: _Ack, x_service_token: str | None = Header(default=None)):
        # 真接口把 consumer 写死成 EPQ_ONLINE_FORMS。本系统调用它就会挪动在线表单
        # 系统的位点。这里只记录，测试断言本系统从不来。
        check(x_service_token)
        state.ack_calls.append(body.through_sequence)
        return {"acknowledged_through": body.through_sequence}

    @app.get("/__mock/stats")
    def stats():
        """仅 mock 有：给浏览器验证时从外部看计数用。真教务没有这个端点。"""
        return {"ackCalls": state.ack_calls, "changeFeedCalls": state.change_feed_calls,
                "detailCalls": len(state.detail_calls)}

    return app


def sample_state(token: str = DEFAULT_TOKEN) -> MockState:
    """浏览器验证用的样例：两位本系统老师 + 一位不用本系统的 IM + 若干项目。"""
    s = MockState(token=token)
    simon = s.user(101, "宋老师", "simon@example.com")
    wang = s.user(102, "王老师", "wang@example.com")
    s.user(201, "赵助理", "zhao@example.com")
    nelly = {"id": 7, "name": "Nelly KauKau", "email": "nelly@example.com"}

    s.add_project("EPQ2601", "章哲睿", student_email="zzr@example.com",
                  term_name="26春季（26年9月提交）", topic_confirmed="Immersion in VR",
                  members=[{"role": "SA", "user": simon}], im_name="赵助理")
    s.add_project("EPQ2602", "林小满（一年期）", student_email="lxm@example.com",
                  term_name="26春季（26年9月提交）",
                  members=[{"role": "TA", "user": simon}, {"role": "SA", "sa_info": nelly}])
    s.add_project("EPQ2603", "陈一鸣", term_name="26秋季（27年3月提交）",
                  topic_initial="AI 与教育", members=[{"role": "SA", "user": simon},
                                                     {"role": "TA", "user": wang}])
    s.add_project("EPQ2604", "只归王老师", term_name="26秋季（27年3月提交）",
                  members=[{"role": "SA", "user": wang}])
    s.add_project("EPQ2605", "已退出的学生", term_name="25秋季（26年3月提交）",
                  members=[{"role": "TA", "user": simon}], is_exit=True)
    return s


if __name__ == "__main__":
    import uvicorn

    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8098)
    ap.add_argument("--token", default=DEFAULT_TOKEN)
    args = ap.parse_args()
    uvicorn.run(create_mock_app(sample_state(args.token)), host="127.0.0.1", port=args.port)
