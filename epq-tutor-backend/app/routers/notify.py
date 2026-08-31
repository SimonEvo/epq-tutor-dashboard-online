"""上课提醒设置 + 手动测试推送。定时推送在 main.py 的 _notify_loop。"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models, notify
from app.auth import get_current_tutor
from app.database import get_db
from app.nag import CN_TZ

router = APIRouter(prefix="/api/notify", tags=["notify"])


class NotifySettings(BaseModel):
    enabled: bool = False
    webhookUrl: str = ""
    digestMode: str = "prev_evening"     # prev_evening | same_morning
    digestTime: str = "21:00"            # HH:MM，北京时间


@router.get("/settings", response_model=NotifySettings)
def get_settings(tutor: models.Tutor = Depends(get_current_tutor)):
    return NotifySettings(**notify.settings_of(tutor))


@router.put("/settings", response_model=NotifySettings)
def put_settings(
    data: NotifySettings,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    if data.digestMode not in notify.DIGEST_MODES:
        raise HTTPException(status_code=422, detail="digestMode 只能是 prev_evening / same_morning")
    if notify.parse_hhmm(data.digestTime) is None:
        raise HTTPException(status_code=422, detail="digestTime 格式应为 HH:MM")
    url = (data.webhookUrl or "").strip()
    if data.enabled and not url:
        raise HTTPException(status_code=422, detail="开启通知前先填 webhook 地址")
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="webhook 地址要以 http:// 或 https:// 开头")

    tutor.notify_enabled = bool(data.enabled)
    tutor.notify_webhook_url = url
    tutor.notify_digest_mode = data.digestMode
    tutor.notify_digest_time = data.digestTime
    db.commit()
    return NotifySettings(**notify.settings_of(tutor))


@router.post("/test")
def test_push(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """按当前配置立刻推一条汇总，用来验 webhook 通不通。不看总开关。"""
    cfg = notify.settings_of(tutor)
    if not cfg["webhookUrl"]:
        raise HTTPException(status_code=422, detail="先填 webhook 地址")
    return notify.run_digest(db, tutor)


@router.get("/preview")
def preview(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """不推送，只回一份下次会发什么，给设置页做预览。"""
    cfg = notify.settings_of(tutor)
    now = datetime.now(CN_TZ)
    if cfg["digestMode"] == "same_morning":
        day, when = now.date(), "今日"
    else:
        day, when = now.date() + timedelta(days=1), "明日"
    items = notify.items_on(db, day)
    return {
        "date": day.isoformat(),
        "whenLabel": when,
        "items": items,
        "markdown": notify.build_digest(day, items, when),
    }
