"""催促提醒接口。
  - POST /api/nag/preview → 扫描 + 规则版 markdown（不推送）。供前端展示 / 喂客户端 AI。
  - POST /api/nag/send    → 手动推送。body 可带 {content} 推送任意 markdown（AI 排序版）。
定时自动推送在 main.py 的 asyncio loop，不经此路由。
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import nag
from app.auth import get_current_tutor
from app.database import get_db
from app import models

router = APIRouter(prefix="/api/nag", tags=["nag"])


class SendRequest(BaseModel):
    content: str | None = None  # 传入则推送这段 markdown（AI 版）；否则跑规则版


@router.post("/preview")
def preview(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    """扫描并返回分组数据 + 规则版 markdown 分条，不推送。"""
    scan = nag.scan_nags(db)
    messages = nag.build_markdown(scan)
    return {"scan": scan, "messages": messages, "webhookConfigured": bool(nag.webhook_url())}


@router.post("/send")
def send(
    data: SendRequest | None = None,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    """手动触发推送。带 content 则推该 markdown（自动分条）；否则跑规则版 run_nag。"""
    if data and data.content and data.content.strip():
        scan = nag.scan_nags(db)  # 复用打包逻辑做分条
        messages = nag._pack(f"# EPQ 每日催促 · {scan['date']} {scan['weekday']}", [data.content.strip()])
        push = nag.send_wecom(messages)
        return {"total": scan["total"], "messages": len(messages), "push": push}
    return nag.run_nag(db)
