"""每日催促提醒——扫描学生进度，拼企业微信 markdown，推送到群机器人。

数据访问全程复用 app.models + SessionLocal，不新建连接。
调度器（main.py 的 asyncio loop）每工作日 09:00(北京时间) 调 run_nag()。
手动触发：`python -m app.nag` 或 POST /api/nag/send（见 routers/nag.py）。

分组规则（据 tutor 敲定）：
  - 未预约下次 SA：next_sa_session 为空
  - 停滞未更新：最近 Session/作业/个人日志 三者取最新 > 阈值(默认7天)
  - 临近 SA：next_sa_session 在未来 ≤2 天内
  - 临近日程：ScheduleEvent 在未来 ≤2 天内
去重优先级：未约SA > 停滞 > 临近，一个学生只进最紧急一组。
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone

import requests as http
from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal

log = logging.getLogger("nag")

# 北京时间固定 UTC+8（中国无夏令时，免 tzdata 依赖）
CN_TZ = timezone(timedelta(hours=8))

_WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

# 企业微信单条 markdown content 上限 4096 字节，留安全余量
_MAX_BYTES = 3800


# ── 配置（env，均有默认） ──────────────────────────────────────────────────
def _cfg_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def stale_days_threshold() -> int:
    return _cfg_int("NAG_STALE_DAYS", 7)


def deadline_days_threshold() -> int:
    return _cfg_int("NAG_DEADLINE_DAYS", 2)


def webhook_url() -> str:
    return (os.getenv("WECOM_WEBHOOK_URL") or "").strip()


# ── 日期工具 ───────────────────────────────────────────────────────────────
def today_cn() -> date:
    return datetime.now(CN_TZ).date()


def _parse_date(s: str | None) -> date | None:
    """宽松解析 ISO 日期字符串（可带时间），失败返回 None。"""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _friendly_when(d: date, today: date) -> str:
    delta = (d - today).days
    label = {0: "今天", 1: "明天", 2: "后天"}.get(delta)
    stamp = d.strftime("%m-%d")
    return f"{label} {stamp}" if label else stamp


def _topic(s: models.Student) -> str:
    t = (s.topic_zh or "").strip() or (s.topic or "").strip()
    return t or "（未定课题）"


# ── 扫描 ───────────────────────────────────────────────────────────────────
def _last_activity(db: Session, student_id: str) -> date | None:
    """最近一次进度活动 = 最近 Session / 作业 / 个人日志 三者取最新。"""
    candidates: list[date] = []

    row = (
        db.query(models.Session.date)
        .filter(models.Session.student_id == student_id)
        .order_by(models.Session.date.desc())
        .first()
    )
    if row:
        d = _parse_date(row[0])
        if d:
            candidates.append(d)

    row = (
        db.query(models.HomeworkEntry.date)
        .filter(models.HomeworkEntry.student_id == student_id)
        .order_by(models.HomeworkEntry.date.desc())
        .first()
    )
    if row:
        d = _parse_date(row[0])
        if d:
            candidates.append(d)

    row = (
        db.query(models.PersonalEntry.date)
        .filter(models.PersonalEntry.student_id == student_id)
        .order_by(models.PersonalEntry.date.desc())
        .first()
    )
    if row:
        d = _parse_date(row[0])
        if d:
            candidates.append(d)

    return max(candidates) if candidates else None


def scan_nags(db: Session, today: date | None = None) -> dict:
    """扫描全部学生，返回分组结果。纯读，无副作用。"""
    today = today or today_cn()
    stale_th = stale_days_threshold()
    dl_th = deadline_days_threshold()

    unscheduled_sa: list[dict] = []
    stale: list[dict] = []
    upcoming_sa: list[dict] = []

    students = db.query(models.Student).order_by(models.Student.name).all()
    for s in students:
        name = s.name
        topic = _topic(s)
        next_sa_raw = (s.next_sa_session or "").strip()
        next_sa = _parse_date(next_sa_raw)

        # 优先级：未约SA > 停滞 > 临近，只进一组
        if not next_sa_raw:
            unscheduled_sa.append({"name": name, "topic": topic})
            continue

        last = _last_activity(db, s.id)
        stale_n = (today - last).days if last else None
        if last is None or stale_n > stale_th:
            stale.append({
                "name": name, "topic": topic,
                "stale_days": stale_n,          # None = 从无任何记录
                "next_sa": next_sa_raw,
            })
            continue

        if next_sa is not None:
            days_until = (next_sa - today).days
            if 0 <= days_until <= dl_th:
                upcoming_sa.append({
                    "name": name, "topic": topic,
                    "next_sa": next_sa_raw,
                    "when": _friendly_when(next_sa, today),
                    "days_until": days_until,
                })

    stale.sort(key=lambda x: (x["stale_days"] is not None, x["stale_days"] or 0), reverse=True)
    upcoming_sa.sort(key=lambda x: x["days_until"])

    # 临近日程（非学生绑定，tutor 自己的会议）
    events: list[dict] = []
    for e in db.query(models.ScheduleEvent).order_by(models.ScheduleEvent.date, models.ScheduleEvent.time).all():
        d = _parse_date(e.date)
        if d is None:
            continue
        days_until = (d - today).days
        if 0 <= days_until <= dl_th:
            events.append({
                "title": e.title or "（无标题）",
                "when": f"{_friendly_when(d, today)} {e.time or ''}".strip(),
            })

    return {
        "date": today.isoformat(),
        "weekday": _WEEKDAYS[today.weekday()],
        "stale_threshold": stale_th,
        "groups": {
            "unscheduled_sa": unscheduled_sa,
            "stale": stale,
            "upcoming_sa": upcoming_sa,
        },
        "events": events,
        "total": len(unscheduled_sa) + len(stale) + len(upcoming_sa) + len(events),
    }


# ── 渲染 markdown ──────────────────────────────────────────────────────────
def build_markdown(scan: dict) -> list[str]:
    """把扫描结果拼成企业微信 markdown，按 4096 字节自动分条。空则返回 []。"""
    if scan["total"] == 0:
        return []

    g = scan["groups"]
    header = f"# EPQ 每日催促 · {scan['date']} {scan['weekday']}"
    blocks: list[str] = []

    if g["unscheduled_sa"]:
        lines = ["**📌 未预约下次 SA**"]
        for it in g["unscheduled_sa"]:
            lines.append(f"**{it['name']}** · {it['topic']}")
            lines.append("<font color=\"warning\">尚未预约</font>下次 SA")
        blocks.append("\n".join(lines))

    if g["stale"]:
        lines = [f"**🐢 停滞未更新（>{scan['stale_threshold']}天）**"]
        for it in g["stale"]:
            lines.append(f"**{it['name']}** · {it['topic']}")
            if it["stale_days"] is None:
                lines.append("<font color=\"warning\">从无任何记录</font>")
            else:
                lines.append(f"已 <font color=\"warning\">{it['stale_days']} 天</font> 无进度")
        blocks.append("\n".join(lines))

    if g["upcoming_sa"]:
        lines = ["**⏰ 临近 SA 会议（≤2天）**"]
        for it in g["upcoming_sa"]:
            lines.append(f"**{it['name']}** · {it['topic']}")
            lines.append(f"下次 SA：<font color=\"warning\">{it['when']}</font>")
        blocks.append("\n".join(lines))

    if scan["events"]:
        lines = ["**📅 临近日程**"]
        for it in scan["events"]:
            lines.append(f"{it['title']} · <font color=\"warning\">{it['when']}</font>")
        blocks.append("\n".join(lines))

    return _pack(header, blocks)


def _pack(header: str, blocks: list[str]) -> list[str]:
    """把 header + 各 block 打包成若干条，每条 ≤ _MAX_BYTES 字节。"""
    messages: list[str] = []
    cur = header
    for block in blocks:
        candidate = f"{cur}\n\n{block}"
        if len(candidate.encode("utf-8")) <= _MAX_BYTES:
            cur = candidate
            continue
        # 当前条放不下这个 block —— 先 flush，再单独处理 block
        if cur != header:
            messages.append(cur)
        # block 自身可能超限（学生极多），按行再拆
        if len(f"{header}\n\n{block}".encode("utf-8")) <= _MAX_BYTES:
            cur = f"{header}\n\n{block}"
        else:
            for chunk in _split_block(header, block):
                messages.append(chunk)
            cur = header
    if cur != header:
        messages.append(cur)
    return messages


def _split_block(header: str, block: str) -> list[str]:
    """单个分组超长时按行切分，每条重复 header + 分组标题。"""
    lines = block.split("\n")
    title = lines[0]
    out: list[str] = []
    cur = f"{header}\n\n{title}"
    for line in lines[1:]:
        candidate = f"{cur}\n{line}"
        if len(candidate.encode("utf-8")) <= _MAX_BYTES:
            cur = candidate
        else:
            out.append(cur)
            cur = f"{header}\n\n{title}\n{line}"
    out.append(cur)
    return out


# ── 推送 ───────────────────────────────────────────────────────────────────
def send_wecom(messages: list[str], url: str | None = None) -> dict:
    """逐条 POST 到企业微信群机器人。返回 {sent, failed, errors}。"""
    url = url or webhook_url()
    if not url:
        log.warning("WECOM_WEBHOOK_URL 未配置，跳过推送")
        return {"sent": 0, "failed": 0, "skipped": True, "errors": ["WECOM_WEBHOOK_URL 未配置"]}

    sent, failed, errors = 0, 0, []
    for i, content in enumerate(messages):
        payload = {"msgtype": "markdown", "markdown": {"content": content}}
        try:
            resp = http.post(url, json=payload, timeout=10)
            if resp.status_code != 200:
                failed += 1
                errors.append(f"第{i+1}条 HTTP {resp.status_code}")
                log.error("企业微信推送失败 第%d条 HTTP %s: %s", i + 1, resp.status_code, resp.text[:200])
                continue
            body = resp.json()
            if body.get("errcode", 0) != 0:
                failed += 1
                errors.append(f"第{i+1}条 errcode {body.get('errcode')}: {body.get('errmsg')}")
                log.error("企业微信推送失败 第%d条 errcode=%s errmsg=%s", i + 1, body.get("errcode"), body.get("errmsg"))
                continue
            sent += 1
        except http.exceptions.RequestException as e:
            failed += 1
            errors.append(f"第{i+1}条 请求异常: {e}")
            log.error("企业微信推送异常 第%d条: %s", i + 1, e)

    return {"sent": sent, "failed": failed, "skipped": False, "errors": errors}


def run_nag(db: Session) -> dict:
    """扫描 → 渲染 → 推送。无人需催促则不发（避免噪音）。"""
    scan = scan_nags(db)
    messages = build_markdown(scan)
    if not messages:
        log.info("今日无需催促的学生，不发消息")
        return {"total": 0, "messages": 0, "push": {"sent": 0, "failed": 0, "skipped": True, "errors": []}}
    push = send_wecom(messages)
    log.info("催促推送完成: 学生/事件=%d, 分条=%d, 成功=%d, 失败=%d",
             scan["total"], len(messages), push["sent"], push["failed"])
    return {"total": scan["total"], "messages": len(messages), "push": push}


# ── CLI 手动触发 ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    db = SessionLocal()
    try:
        result = run_nag(db)
        print(result)
    finally:
        db.close()
