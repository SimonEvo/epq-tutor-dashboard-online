"""账号管理（仅 admin）。

## 边界

这里**只暴露元数据**：用户名、角色、状态、创建/最后登录时间、学生数、AI 调用次数。
没有任何读取他人学生、纪要、私密笔记的端点，也没有「以某用户身份登录」。

这是硬约束，不是产品选项 —— 见 docs/adr/0004-multi-tenant-internal-beta.md 决策 5。
内测老师愿意把真实学生信息录进来的前提就是这个。要破例请先改 ADR。

## 为什么没有删除账号

停用（status=disabled）足以挡住登录，且可逆。删账号会连带他名下的学生、纪要、
知识库一起变成孤儿数据 —— 那是一次数据销毁，不该藏在一个管理面按钮后面。
真要清理，走人工确认的脚本。
"""
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import ai_config, models
from app.auth import hash_password
from app.database import get_db
from app.scoping import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

MIN_PASSWORD_LEN = 8
ROLES = ("tutor", "admin")
STATUSES = ("active", "disabled")


class TutorSummary(BaseModel):
    id: str
    username: str
    displayName: str = ""
    role: str
    status: str
    createdAt: str = ""
    lastLoginAt: str = ""
    studentCount: int = 0
    aiCallCount: int = 0


class CreateTutorRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=128)
    displayName: str = ""
    role: str = "tutor"


class UpdateTutorRequest(BaseModel):
    displayName: str | None = None
    role: str | None = None
    status: str | None = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=MIN_PASSWORD_LEN, max_length=128)


def _iso(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


def _load(db: Session, tutor_id: str) -> models.Tutor:
    t = db.query(models.Tutor).filter(models.Tutor.id == tutor_id).first()
    if t is None:
        raise HTTPException(status_code=404, detail="账号不存在")
    return t


def _summaries(db: Session) -> list[TutorSummary]:
    student_counts = dict(
        db.query(models.Student.tutor_id, func.count(models.Student.id))
        .group_by(models.Student.tutor_id).all()
    )
    # 只数 entity_type='ai_call' —— 那是 ai.py 在每次真的调用 provider 时记的。
    # action='ai_generate' 还会被 students.py / reports.py 在「报告落库」时记一笔，
    # 两者都算就会把一次生成数成两次。
    ai_counts = dict(
        db.query(models.ActionLog.tutor_id, func.count(models.ActionLog.id))
        .filter(
            models.ActionLog.action == "ai_generate",
            models.ActionLog.entity_type == "ai_call",
        )
        .group_by(models.ActionLog.tutor_id).all()
    )
    rows = db.query(models.Tutor).order_by(models.Tutor.created_at).all()
    return [
        TutorSummary(
            id=t.id, username=t.username, displayName=t.display_name or "",
            role=t.role, status=t.status,
            createdAt=_iso(t.created_at), lastLoginAt=_iso(t.last_login_at),
            studentCount=student_counts.get(t.id, 0),
            aiCallCount=ai_counts.get(t.id, 0),
        )
        for t in rows
    ]


@router.get("/tutors", response_model=list[TutorSummary])
def list_tutors(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return _summaries(db)


@router.post("/tutors", response_model=TutorSummary, status_code=201)
def create_tutor(
    body: CreateTutorRequest,
    db: Session = Depends(get_db),
    _admin: models.Tutor = Depends(require_admin),
):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="用户名不能为空")
    if body.role not in ROLES:
        raise HTTPException(status_code=422, detail=f"角色只能是 {' / '.join(ROLES)}")
    if db.query(models.Tutor).filter(models.Tutor.username == username).first():
        raise HTTPException(status_code=409, detail="用户名已存在")

    tutor = models.Tutor(
        id=str(uuid.uuid4()),
        username=username,
        password_hash=hash_password(body.password),
        display_name=body.displayName.strip() or None,
        role=body.role,
        status="active",
        token_version=1,
        ics_token=secrets.token_urlsafe(24),
        created_at=datetime.now(timezone.utc),
    )
    db.add(tutor)
    db.commit()
    return next(s for s in _summaries(db) if s.id == tutor.id)


@router.patch("/tutors/{tutor_id}", response_model=TutorSummary)
def update_tutor(
    tutor_id: str,
    body: UpdateTutorRequest,
    db: Session = Depends(get_db),
    admin: models.Tutor = Depends(require_admin),
):
    target = _load(db, tutor_id)

    if body.displayName is not None:
        target.display_name = body.displayName.strip() or None

    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(status_code=422, detail=f"角色只能是 {' / '.join(ROLES)}")
        if target.id == admin.id and body.role != "admin":
            # 自我降权会把最后一个管理员锁在门外，且没有恢复入口
            raise HTTPException(status_code=422, detail="不能取消自己的管理员权限")
        target.role = body.role

    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(status_code=422, detail=f"状态只能是 {' / '.join(STATUSES)}")
        if target.id == admin.id and body.status != "active":
            raise HTTPException(status_code=422, detail="不能停用自己")
        if target.status != body.status:
            target.status = body.status
            if body.status == "disabled":
                # 停用必须让已签发的令牌当场失效，否则对方还能用旧 token 用满 7 天
                target.token_version = (target.token_version or 1) + 1

    db.commit()
    return next(s for s in _summaries(db) if s.id == target.id)


@router.post("/tutors/{tutor_id}/reset-password", response_model=TutorSummary)
def reset_password(
    tutor_id: str,
    body: ResetPasswordRequest,
    db: Session = Depends(get_db),
    _admin: models.Tutor = Depends(require_admin),
):
    target = _load(db, tutor_id)
    target.password_hash = hash_password(body.password)
    # 改密码同样作废旧令牌 —— 否则"重置密码"挡不住已经登录的人
    target.token_version = (target.token_version or 1) + 1
    db.commit()
    return next(s for s in _summaries(db) if s.id == target.id)


# ── 机构共享 AI 凭据 ─────────────────────────────────────────────────────────

class AiConfigView(BaseModel):
    configured: bool
    keyHint: str = ""
    baseUrl: str
    model: str


class AiConfigUpdate(BaseModel):
    # None = 不改这一项。空串对 apiKey 意味着「清空」，需显式传。
    apiKey: str | None = None
    baseUrl: str | None = None
    model: str | None = None


@router.get("/ai-config", response_model=AiConfigView)
def get_ai_config(db: Session = Depends(get_db), _admin=Depends(require_admin)):
    return AiConfigView(**ai_config.public_view(db))


@router.put("/ai-config", response_model=AiConfigView)
def set_ai_config(
    body: AiConfigUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    if body.apiKey is not None:
        ai_config.put(db, ai_config.KEY_API_KEY, body.apiKey.strip())
    if body.baseUrl is not None:
        ai_config.put(db, ai_config.KEY_BASE_URL, body.baseUrl.strip())
    if body.model is not None:
        ai_config.put(db, ai_config.KEY_MODEL, body.model.strip())
    db.commit()
    return AiConfigView(**ai_config.public_view(db))
