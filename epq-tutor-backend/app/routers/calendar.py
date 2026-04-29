from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import get_current_tutor

router = APIRouter(tags=["calendar"])

_ics_store: dict[str, str] = {}  # in-memory; survives process lifetime


@router.put("/api/calendar")
def publish_calendar(
    body: dict,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    _ics_store["content"] = body.get("ics", "")
    return {"ok": True}


@router.get("/api/calendar/config")
def get_calendar_config(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    return {"gistId": "backend"}


@router.put("/api/calendar/config")
def save_calendar_config(
    body: dict,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    return {"ok": True}


# Public endpoint — no auth required so calendar apps can subscribe
@router.get("/api/calendar.ics", response_class=PlainTextResponse)
def serve_ics():
    content = _ics_store.get("content", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR")
    return PlainTextResponse(content=content, media_type="text/calendar; charset=utf-8")
