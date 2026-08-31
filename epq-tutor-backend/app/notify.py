"""上课提醒 webhook。

两种推送：
  1. 每日汇总 —— 前一天晚上 x 点推第二天的，或当天早上 x 点推当天的（二选一）
  2. 课前 15 分钟 —— 只推勾了 notify_15min 的那些安排

webhook URL 存在 tutors.notify_webhook_url（不是 .env），和「群催促」用的
WECOM_WEBHOOK_URL 是两套，互不影响。负载格式复用企业微信群机器人 markdown。

定时循环在 main.py 的 _notify_loop，不在这里。
"""
import logging
from datetime import date, datetime, timedelta

import requests as http
from sqlalchemy.orm import Session

from app import models
from app.nag import CN_TZ

log = logging.getLogger(__name__)

DIGEST_MODES = ("prev_evening", "same_morning")
LEAD_MINUTES = 15

TYPE_LABEL = {"SA_MEETING": "SA", "TA_MEETING": "TA", "THEORY": "理论课"}


# ── 设置读写 ──────────────────────────────────────────────────────────────────
def settings_of(tutor: models.Tutor) -> dict:
    mode = tutor.notify_digest_mode or "prev_evening"
    if mode not in DIGEST_MODES:
        mode = "prev_evening"
    return {
        "enabled": bool(tutor.notify_enabled),
        "webhookUrl": tutor.notify_webhook_url or "",
        "digestMode": mode,
        "digestTime": tutor.notify_digest_time or "21:00",
    }


def parse_hhmm(s: str | None) -> tuple[int, int] | None:
    if not s:
        return None
    try:
        h, m = s.split(":")
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h, m


# ── 取某一天的所有安排 ─────────────────────────────────────────────────────────
def _mins(hhmm: str | None) -> int:
    p = parse_hhmm(hhmm)
    return p[0] * 60 + p[1] if p else 24 * 60 + 1   # 无时间的排最后


def items_on(db: Session, day: date) -> list[dict]:
    """当天所有带时间的安排，按开始时间排序。"""
    iso = day.isoformat()
    out: list[dict] = []

    rows = (
        db.query(models.Session, models.Student.name)
        .join(models.Student, models.Session.student_id == models.Student.id)
        .filter(models.Session.date == iso)
        .all()
    )
    for sess, student_name in rows:
        out.append({
            "kind": "session",
            "id": sess.id,
            "time": sess.time or "",
            "durationMinutes": sess.duration_minutes or 0,
            "label": "最终答辩" if sess.is_final_defense else TYPE_LABEL.get(sess.type, sess.type),
            "who": student_name,
            "notify15": bool(sess.notify_15min),
        })

    for t in db.query(models.Trial).filter(models.Trial.date == iso).all():
        out.append({
            "kind": "trial", "id": t.id, "time": t.time or "",
            "durationMinutes": t.duration_minutes or 0,
            "label": "试听", "who": t.student_name or "",
            "notify15": bool(t.notify_15min),
        })

    for g in db.query(models.GroupClass).filter(models.GroupClass.date == iso).all():
        out.append({
            "kind": "group", "id": g.id, "time": g.time or "",
            "durationMinutes": g.duration_minutes or 0,
            "label": "团课", "who": g.title or "",
            "notify15": bool(g.notify_15min),
        })

    for e in db.query(models.ScheduleEvent).filter(models.ScheduleEvent.date == iso).all():
        out.append({
            "kind": "event", "id": e.id, "time": e.time or "",
            "durationMinutes": e.duration_minutes or 0,
            "label": "加班" if e.counts_as_overtime else "事件",
            "who": e.title or "",
            "notify15": bool(e.notify_15min),
        })

    out.sort(key=lambda x: (_mins(x["time"]), x["label"]))
    return out


# ── 文案 ─────────────────────────────────────────────────────────────────────
WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]


def _end_time(time_str: str, minutes: int) -> str:
    p = parse_hhmm(time_str)
    if not p or minutes <= 0:
        return ""
    total = p[0] * 60 + p[1] + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def build_digest(day: date, items: list[dict], when_label: str) -> str:
    head = f"# {when_label}安排 · {day.isoformat()} 周{WEEKDAYS[day.weekday()]}"
    if not items:
        return f"{head}\n\n没有安排，好好休息。"
    lines = []
    for it in items:
        end = _end_time(it["time"], it["durationMinutes"])
        span = f"{it['time']}–{end}" if end else (it["time"] or "待定")
        bell = " 🔔" if it["notify15"] else ""
        lines.append(f"> **{span}**　{it['label']}　{it['who']}{bell}")
    return f"{head}\n\n共 {len(items)} 项\n" + "\n".join(lines)


def build_lead_reminder(it: dict, start: datetime) -> str:
    end = _end_time(it["time"], it["durationMinutes"])
    span = f"{it['time']}–{end}" if end else it["time"]
    return (
        f"# ⏰ {LEAD_MINUTES} 分钟后：{it['label']}　{it['who']}\n\n"
        f"> **{span}**　{start.date().isoformat()}"
    )


# ── 推送 ─────────────────────────────────────────────────────────────────────
def send(url: str, content: str) -> dict:
    """POST 一条企业微信 markdown。返回 {ok, error}。"""
    if not url:
        return {"ok": False, "error": "webhook 未配置"}
    try:
        resp = http.post(url, json={"msgtype": "markdown", "markdown": {"content": content}}, timeout=10)
    except Exception as exc:                                  # noqa: BLE001
        log.error("上课提醒推送异常: %s", exc)
        return {"ok": False, "error": str(exc)}
    if resp.status_code != 200:
        log.error("上课提醒推送失败 HTTP %s: %s", resp.status_code, resp.text[:200])
        return {"ok": False, "error": f"HTTP {resp.status_code}"}
    try:
        body = resp.json()
    except ValueError:
        return {"ok": True, "error": ""}                       # 非企微端点，只要 200 就算成功
    if body.get("errcode", 0) != 0:
        return {"ok": False, "error": f"errcode {body.get('errcode')}: {body.get('errmsg')}"}
    return {"ok": True, "error": ""}


# ── 定时循环调用的两个入口 ─────────────────────────────────────────────────────
def run_digest(db: Session, tutor: models.Tutor) -> dict:
    cfg = settings_of(tutor)
    now = datetime.now(CN_TZ)
    if cfg["digestMode"] == "same_morning":
        day, when = now.date(), "今日"
    else:
        day, when = now.date() + timedelta(days=1), "明日"
    items = items_on(db, day)
    result = send(cfg["webhookUrl"], build_digest(day, items, when))
    return {"date": day.isoformat(), "items": len(items), **result}


def due_lead_reminders(db: Session, now: datetime) -> list[tuple[str, str]]:
    """返回 [(去重键, markdown)]：开始时间正好落在 now+15min 那一分钟的安排。"""
    target = now + timedelta(minutes=LEAD_MINUTES)
    out: list[tuple[str, str]] = []
    for it in items_on(db, target.date()):
        if not it["notify15"] or not it["time"]:
            continue
        p = parse_hhmm(it["time"])
        if not p:
            continue
        if p[0] == target.hour and p[1] == target.minute:
            key = f"{target.date().isoformat()}:{it['kind']}:{it['id']}"
            out.append((key, build_lead_reminder(it, target)))
    return out
