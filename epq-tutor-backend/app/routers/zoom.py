from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import base64
import requests as req
from app.auth import get_current_tutor
from app import models

_UTC8 = timezone(timedelta(hours=8))

router = APIRouter(prefix="/api/zoom", tags=["zoom"])


class ZoomSummaryRequest(BaseModel):
    meeting_id: str
    account_id: str
    client_id: str
    client_secret: str


@router.post("/meeting-summary")
def get_zoom_meeting_summary(
    body: ZoomSummaryRequest,
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    # Server-to-Server OAuth: get access token
    creds = base64.b64encode(f"{body.client_id}:{body.client_secret}".encode()).decode()
    token_resp = req.post(
        f"https://zoom.us/oauth/token?grant_type=account_credentials&account_id={body.account_id}",
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=15,
    )
    if not token_resp.ok:
        raise HTTPException(status_code=400, detail=f"Zoom 认证失败：{token_resp.text}")
    access_token = token_resp.json().get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Zoom 认证失败：未获取到 access_token")

    # Fetch meeting summary
    summary_resp = req.get(
        f"https://api.zoom.us/v2/meetings/{body.meeting_id}/meeting_summary",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    if not summary_resp.ok:
        raise HTTPException(status_code=summary_resp.status_code, detail=f"Zoom API 错误：{summary_resp.text}")

    data = summary_resp.json()
    return {
        "summary_content": data.get("summary_content", ""),
        "meeting_topic": data.get("meeting_topic", ""),
        "meeting_start_time": data.get("meeting_start_time", ""),
    }


class ZoomCreateMeetingRequest(BaseModel):
    account_id: str
    client_id: str
    client_secret: str
    topic: str
    start_time: str   # "2026-05-13T14:00:00"
    duration: int     # minutes
    timezone: str = "Asia/Shanghai"


def _get_token(account_id: str, client_id: str, client_secret: str) -> str:
    creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = req.post(
        f"https://zoom.us/oauth/token?grant_type=account_credentials&account_id={account_id}",
        headers={"Authorization": f"Basic {creds}", "Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    if not resp.ok:
        raise HTTPException(status_code=400, detail=f"Zoom 认证失败：{resp.text}")
    token = resp.json().get("access_token")
    if not token:
        raise HTTPException(status_code=400, detail="Zoom 认证失败：未获取到 access_token")
    return token


@router.post("/create-meeting")
def create_zoom_meeting(
    body: ZoomCreateMeetingRequest,
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    token = _get_token(body.account_id, body.client_id, body.client_secret)

    # ── Conflict check ────────────────────────────────────────────────────────
    meetings_resp = req.get(
        "https://api.zoom.us/v2/users/me/meetings",
        headers={"Authorization": f"Bearer {token}"},
        params={"type": "upcoming", "page_size": 300},
        timeout=15,
    )
    if not meetings_resp.ok:
        raise HTTPException(
            status_code=503,
            detail="无法获取已有会议列表以检查时间冲突，请稍后重试",
        )

    # Parse new meeting time in UTC+8 (start_time is local Asia/Shanghai, no tz suffix)
    new_start = datetime.fromisoformat(body.start_time).replace(tzinfo=_UTC8)
    new_end = new_start + timedelta(minutes=body.duration)

    conflicts = []
    for m in meetings_resp.json().get("meetings", []):
        m_start_str = m.get("start_time", "")
        if not m_start_str:
            continue
        try:
            m_start = datetime.fromisoformat(m_start_str.replace("Z", "+00:00"))
            m_end = m_start + timedelta(minutes=m.get("duration", 0))
            if new_start < m_end and new_end > m_start:
                m_start_local = m_start.astimezone(_UTC8)
                m_end_local = m_end.astimezone(_UTC8)
                conflicts.append({
                    "topic": m.get("topic") or "(no topic)",
                    "start": m_start_local.strftime("%H:%M"),
                    "end": m_end_local.strftime("%H:%M"),
                })
        except Exception:
            continue

    if conflicts:
        raise HTTPException(status_code=409, detail=conflicts)

    # ── Create meeting ────────────────────────────────────────────────────────
    meeting_resp = req.post(
        "https://api.zoom.us/v2/users/me/meetings",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "topic": body.topic,
            "type": 2,                  # scheduled meeting
            "start_time": body.start_time,
            "duration": body.duration,
            "timezone": body.timezone,
            "settings": {
                "waiting_room": False,
                "join_before_host": True,
                "auto_recording": "none",
            },
        },
        timeout=15,
    )
    if not meeting_resp.ok:
        raise HTTPException(status_code=meeting_resp.status_code, detail=f"Zoom API 错误：{meeting_resp.text}")

    data = meeting_resp.json()
    return {
        "meetingId": str(data.get("id", "")),
        "joinUrl": data.get("join_url", ""),
        "password": data.get("password", ""),
        "startUrl": data.get("start_url", ""),
    }


class ZoomCancelMeetingRequest(BaseModel):
    meeting_id: str
    account_id: str
    client_id: str
    client_secret: str


@router.post("/cancel-meeting")
def cancel_zoom_meeting(
    body: ZoomCancelMeetingRequest,
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    token = _get_token(body.account_id, body.client_id, body.client_secret)
    resp = req.delete(
        f"https://api.zoom.us/v2/meetings/{body.meeting_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    if resp.status_code not in (204, 404):
        raise HTTPException(status_code=resp.status_code, detail=f"Zoom API 错误：{resp.text}")
    return {"ok": True}
