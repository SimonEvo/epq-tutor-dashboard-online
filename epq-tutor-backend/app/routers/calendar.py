"""日历订阅。

前端生成 ICS 文本后 PUT 上来，日历应用通过一个公开 URL 订阅。

P1 之前这里是**一份全局的内存副本 + 无鉴权的 /api/calendar.ics**：
多账号下 B 发布会覆盖 A 的日历，且任何人都能匿名拉到全文（含学生姓名和课表）。
现在按 tutor 分开存，公开地址带一个不可猜测的 token（tutors.ics_token）。

仍然是内存存储 —— 进程重启后为空，直到前端下次发布。这是改造前就有的行为，
本次只做隔离，不改持久化方式。
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_tutor
from app.database import get_db

router = APIRouter(tags=["calendar"])

_EMPTY_ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR"

# tutor_id -> ICS 文本
_ics_store: dict[str, str] = {}


def _ensure_token(db: Session, tutor: models.Tutor) -> str:
    """老账号可能还没有 token（迁移会补，但新建账号走代码路径）。"""
    if not tutor.ics_token:
        import secrets

        tutor.ics_token = secrets.token_urlsafe(24)
        db.commit()
    return tutor.ics_token


def _subscribe_path(token: str) -> str:
    return f"/api/calendar/{token}.ics"


@router.put("/api/calendar")
def publish_calendar(
    body: dict,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    _ics_store[tutor.id] = body.get("ics", "")
    return {"ok": True, "url": _subscribe_path(_ensure_token(db, tutor))}


@router.get("/api/calendar/subscription")
def get_subscription_url(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """前端展示「订阅地址」用。token 只发给本人。"""
    return {"url": _subscribe_path(_ensure_token(db, tutor))}


@router.get("/api/calendar/config")
def get_calendar_config(
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    return {"gistId": "backend"}


@router.put("/api/calendar/config")
def save_calendar_config(
    body: dict,
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    return {"ok": True}


# 公开端点 —— 日历应用不会带 Authorization 头，靠 URL 里的 token 鉴别身份。
# token 不可枚举，且只对应一个租户的日历。
@router.get("/api/calendar/{token}.ics", response_class=PlainTextResponse)
def serve_ics(token: str, db: Session = Depends(get_db)):
    tutor = db.query(models.Tutor).filter(models.Tutor.ics_token == token).first()
    if tutor is None:
        raise HTTPException(status_code=404, detail="Not found")
    return PlainTextResponse(
        content=_ics_store.get(tutor.id, _EMPTY_ICS),
        media_type="text/calendar; charset=utf-8",
    )


# 兼容旧订阅地址：系统所有者（admin）原先订阅的就是这个无 token 的 URL，
# 直接下线会让他手机上的日历订阅静默失效。仅服务 admin 的日历。
# 待 admin 换用带 token 的地址后删除本端点。
@router.get("/api/calendar.ics", response_class=PlainTextResponse, deprecated=True)
def serve_ics_legacy(db: Session = Depends(get_db)):
    admin = db.query(models.Tutor).filter(models.Tutor.role == "admin").first()
    content = _ics_store.get(admin.id, _EMPTY_ICS) if admin else _EMPTY_ICS
    return PlainTextResponse(content=content, media_type="text/calendar; charset=utf-8")
