"""Student Knowledge Base — Living Summary (layer 2) + Raw entries (layer 3).

Layer-1 context assembly and the multi-turn chat / digest endpoints live
elsewhere (kb-context here in P3; chat in ai.py). This module holds the
persistence CRUD plus the layer-1 assembly endpoint.
"""
import json
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.name_encoding import build_name_mappings, encode_names, decode_names, generate_ai_alias
from app.routers.config import effective_kb_sources
from app.schemas import (
    LivingSummarySchema,
    LivingSummaryUpdateSchema,
    KnowledgeEntrySchema,
    KnowledgeEntryCreateSchema,
)

router = APIRouter(prefix="/api/students", tags=["knowledge-base"])

# EPQ milestone id -> label (mirror of tutoring-system/src/config.ts EPQ_MILESTONES).
MILESTONE_LABELS = {
    "questionnaire": "问卷", "intro": "Intro", "lit_review": "文综",
    "methodology": "方法论", "results": "结果", "discussion": "讨论",
    "reflection": "反思", "conclusion": "结语", "bibliography": "文献",
    "abstract": "摘要", "table1": "表1", "table2": "表2", "table4": "表4",
    "table5": "表5", "table6": "表6", "table7": "表7", "table11": "表11",
    "defense": "答辩", "submission": "提交",
}
MILESTONE_STATUS_LABELS = {
    "not_started": "未开始", "in_progress": "进行中", "completed": "已完成", "na": "N/A",
}
SESSION_TYPE_LABELS = {"SA_MEETING": "SA", "TA_MEETING": "TA", "THEORY": "理论课"}


def _iso(dt: datetime | None) -> str:
    return dt.isoformat() if dt else ""


def _verify_student(db: Session, student_id: str, tutor_id: str) -> models.Student:
    s = (
        db.query(models.Student)
        .filter(models.Student.id == student_id, models.Student.tutor_id == tutor_id)
        .first()
    )
    if s is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return s


def _entry_to_schema(e: models.StudentKnowledgeEntry) -> KnowledgeEntrySchema:
    return KnowledgeEntrySchema(
        id=e.id, content=e.content, source=e.source,
        createdAt=_iso(e.created_at), digestedAt=_iso(e.digested_at) if e.digested_at else None,
    )


# ── Living Summary (layer 2) ──────────────────────────────────────────────────

@router.get("/{student_id}/living-summary", response_model=LivingSummarySchema)
def get_living_summary(
    student_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    _verify_student(db, student_id, tutor.id)
    row = (
        db.query(models.StudentLivingSummary)
        .filter(models.StudentLivingSummary.student_id == student_id)
        .first()
    )
    if row is None:
        return LivingSummarySchema(content="", updatedAt="")
    return LivingSummarySchema(content=row.content or "", updatedAt=_iso(row.updated_at))


@router.put("/{student_id}/living-summary", response_model=LivingSummarySchema)
def put_living_summary(
    student_id: str,
    data: LivingSummaryUpdateSchema,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    _verify_student(db, student_id, tutor.id)
    row = (
        db.query(models.StudentLivingSummary)
        .filter(models.StudentLivingSummary.student_id == student_id)
        .first()
    )
    now = datetime.now(timezone.utc)
    if row is None:
        row = models.StudentLivingSummary(student_id=student_id, content=data.content, updated_at=now)
        db.add(row)
    else:
        row.content = data.content
        row.updated_at = now

    # Archive digested entries atomically with the summary save (P5 merge path).
    if data.digestedEntryIds:
        (
            db.query(models.StudentKnowledgeEntry)
            .filter(
                models.StudentKnowledgeEntry.student_id == student_id,
                models.StudentKnowledgeEntry.id.in_(data.digestedEntryIds),
                models.StudentKnowledgeEntry.digested_at.is_(None),
            )
            .update({models.StudentKnowledgeEntry.digested_at: now}, synchronize_session=False)
        )

    db.commit()
    return LivingSummarySchema(content=row.content or "", updatedAt=_iso(row.updated_at))


# ── Raw entries (layer 3) ─────────────────────────────────────────────────────

@router.get("/{student_id}/knowledge-entries", response_model=list[KnowledgeEntrySchema])
def list_knowledge_entries(
    student_id: str,
    all: bool = False,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    _verify_student(db, student_id, tutor.id)
    q = (
        db.query(models.StudentKnowledgeEntry)
        .filter(models.StudentKnowledgeEntry.student_id == student_id)
    )
    if not all:
        q = q.filter(models.StudentKnowledgeEntry.digested_at.is_(None))
    rows = q.order_by(models.StudentKnowledgeEntry.created_at.desc()).all()
    return [_entry_to_schema(e) for e in rows]


@router.post("/{student_id}/knowledge-entries", response_model=KnowledgeEntrySchema)
def create_knowledge_entry(
    student_id: str,
    data: KnowledgeEntryCreateSchema,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    _verify_student(db, student_id, tutor.id)
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content required")
    source = data.source if data.source in ("manual", "wechat", "ai") else "manual"
    entry = models.StudentKnowledgeEntry(
        id=str(uuid.uuid4()), student_id=student_id, content=content,
        source=source, created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _entry_to_schema(entry)


@router.delete("/{student_id}/knowledge-entries/{entry_id}")
def delete_knowledge_entry(
    student_id: str,
    entry_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    _verify_student(db, student_id, tutor.id)
    entry = (
        db.query(models.StudentKnowledgeEntry)
        .filter(
            models.StudentKnowledgeEntry.id == entry_id,
            models.StudentKnowledgeEntry.student_id == student_id,
        )
        .first()
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"ok": True}


# ── Layer 1 — auto-assembled structured context ───────────────────────────────

def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _is_session_started(sess) -> bool:
    """Mirror of frontend isSessionStarted (formatters.ts): a session counts as
    started only once its date (and time, if set) has passed. Not-started
    sessions must be excluded from all history / SA-hour reasoning so the AI
    doesn't treat an upcoming meeting as an empty-record past one.

    Matches the frontend exactly: date compared in UTC, time in CST.
    """
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    if sess.date < today:
        return True
    if sess.date > today:
        return False
    if not sess.time:
        return True
    cst = now.astimezone(timezone(timedelta(hours=8)))
    return cst.strftime("%H:%M") >= sess.time


def _load_full_student(db: Session, student_id: str, tutor_id: str) -> models.Student:
    s = (
        db.query(models.Student)
        .options(
            selectinload(models.Student.sessions),
            selectinload(models.Student.milestones),
            selectinload(models.Student.homework_entries),
        )
        .filter(models.Student.id == student_id, models.Student.tutor_id == tutor_id)
        .first()
    )
    if s is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return s


def _assemble_context(db: Session, s: models.Student, sources: dict[str, bool]) -> str:
    """Build the layer-1 markdown block (real names — encoded by the caller)."""
    parts: list[str] = [f"# 学生档案：{s.name}" + (f"（{s.name_en}）" if s.name_en else "")]

    if sources.get("profile"):
        prof = []
        if s.overview:
            prof.append(f"- 方向概览：{s.overview}")
        if s.topic_zh or s.topic:
            prof.append(f"- 课题：{s.topic_zh or s.topic}")
        if s.brief_note:
            prof.append(f"- 速记：{s.brief_note}")
        if prof:
            parts.append("## 基本信息\n" + "\n".join(prof))

    if sources.get("submission_round") and s.submission_round:
        parts.append(f"## 学期\n{s.submission_round}")

    # Not-started sessions are excluded from all history / hour reasoning below;
    # they may still surface as "下次 SA/TA" in meeting_dates (that's their point).
    past = [x for x in s.sessions if _is_session_started(x)]
    future = [x for x in s.sessions if not _is_session_started(x)]

    if sources.get("sa_hours"):
        sa_past = [x for x in past if x.type == "SA_MEETING"]
        used = len(sa_past)
        total = s.sa_hours_total or 0
        remaining = total - used
        mins = sum(x.duration_minutes or 0 for x in sa_past)
        dur = f"{mins // 60}h{mins % 60}min"
        parts.append(
            f"## SA 课时\n- SA 课次：已用 {used} / 共 {total}，剩余 {remaining}\n- SA 累计时长：{dur}"
        )

    if sources.get("meeting_dates"):
        def last_of(t):
            xs = [x.date for x in past if x.type == t]
            return max(xs) if xs else None

        def next_of(t):
            xs = [x.date for x in future if x.type == t]
            return min(xs) if xs else None

        lines = []
        for t, label in (("SA_MEETING", "SA"), ("TA_MEETING", "TA")):
            lines.append(f"- 上次 {label}：{last_of(t) or '无'}；下次 {label}：{next_of(t) or '无'}")
        parts.append("## 会面日期\n" + "\n".join(lines))

    if sources.get("sessions"):
        # Only started sessions — an upcoming meeting has no record to report.
        rows = []
        for x in sorted(past, key=lambda x: x.date):
            label = SESSION_TYPE_LABELS.get(x.type, x.type)
            title = f" {x.title}" if x.title else ""
            summary = (x.summary or "").strip() or "（无记录）"
            rows.append(f"- {x.date} [{label}]{title}：{summary}")
        parts.append("## 课程历史\n" + ("\n".join(rows) if rows else "（暂无课程）"))

    if sources.get("milestones"):
        ms = {m.milestone_id: m.status for m in s.milestones}
        rows = []
        for mid, label in MILESTONE_LABELS.items():
            if mid in ms:
                rows.append(f"- {label}：{MILESTONE_STATUS_LABELS.get(ms[mid], ms[mid])}")
        if rows:
            parts.append("## EPQ 里程碑\n" + "\n".join(rows))

    if sources.get("schedule_entries"):
        entries = s.schedule_entries or []
        if entries:
            latest = entries[0]
            content = latest.get("content", "") if isinstance(latest, dict) else str(latest)
            recorded = latest.get("recordedAt", "") if isinstance(latest, dict) else ""
            parts.append(f"## 考试 / 可用时间（最新）\n- {recorded}：{content}")

    if sources.get("homework"):
        rows = []
        for h in sorted(s.homework_entries, key=lambda h: h.date, reverse=True):
            items = h.items or []
            done = sum(1 for it in items if isinstance(it, dict) and it.get("done"))
            item_txt = "；".join(
                f"{'✓' if (isinstance(it, dict) and it.get('done')) else '○'}"
                f"{it.get('text', '') if isinstance(it, dict) else it}"
                for it in items
            )
            rows.append(f"- {h.date} {h.source_label}（{done}/{len(items)}）：{item_txt}")
        if rows:
            parts.append("## 作业\n" + "\n".join(rows))

    if sources.get("gantt_events"):
        proj = (
            db.query(models.GanttProject)
            .filter(
                models.GanttProject.owner_type == "student",
                models.GanttProject.owner_id == s.id,
            )
            .first()
        )
        tasks = (proj.data or {}).get("tasks", []) if proj else []
        rows = []
        for t in sorted(tasks, key=lambda t: t.get("startDate", "")):
            name = t.get("name", "")
            if t.get("milestone") or not t.get("endDate"):
                rows.append(f"- {t.get('startDate', '')} ◆ {name}")
            else:
                rows.append(f"- {t.get('startDate', '')}~{t.get('endDate', '')} {name}")
        if rows:
            parts.append("## 甘特事件（考试 / 假期 / 截止）\n" + "\n".join(rows))

    if sources.get("private_notes") and (s.private_notes or "").strip():
        # Second exception: privateNotes allowed in tutor-only KB context.
        parts.append(f"## 导师私人备注\n{s.private_notes.strip()}")

    return "\n\n".join(parts)


def ensure_all_aliases(db: Session, tutor_id: str) -> list[models.Student]:
    """Guarantee every student of this tutor has an alias, then return them.

    Aliases are the basis for name encoding at the AI boundary. A student
    without one would have their real name leak, so we backfill any missing.
    """
    students = db.query(models.Student).filter(models.Student.tutor_id == tutor_id).all()
    existing = [s.ai_alias.strip() for s in students if (s.ai_alias or "").strip()]
    dirty = False
    for s in students:
        if not (s.ai_alias or "").strip():
            alias = generate_ai_alias(existing)
            s.ai_alias = alias
            existing.append(alias)
            dirty = True
    if dirty:
        db.commit()
    return students


@router.get("/{student_id}/kb-context")
def get_kb_context(
    student_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """Layer 1: pull enabled sources and assemble the markdown context block.

    Returns REAL names — the frontend is tutor-only and already holds every
    student's real name. Name encoding is applied at the single AI boundary
    (POST /api/ai/chat and the digest endpoints), never here. This keeps
    encoding centralized in exactly one place (the ADR's intent) and avoids
    double-encoding an already-encoded blob.
    """
    s = _load_full_student(db, student_id, tutor.id)
    sources = effective_kb_sources(tutor)
    context = _assemble_context(db, s, sources)
    return {"context": context, "charCount": len(context)}


# ── Digest (layer 3 -> layer 2) ───────────────────────────────────────────────

class ChatMsg(BaseModel):
    role: str
    content: str


class DigestRequest(BaseModel):
    messages: list[ChatMsg] = []
    apiKey: str
    model: str = "deepseek-v4"
    baseUrl: str = "https://api.deepseek.com/v1"
    maxTokens: int = 2048


class MergeRequest(BaseModel):
    approvedFacts: list[str]
    apiKey: str
    model: str = "deepseek-v4"
    baseUrl: str = "https://api.deepseek.com/v1"
    maxTokens: int = 4096


def _extract_json_array(text: str) -> list[str] | None:
    """Best-effort parse of a JSON string array from an AI reply."""
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return None
    try:
        arr = json.loads(m.group(0))
        return [str(x).strip() for x in arr if str(x).strip()]
    except (json.JSONDecodeError, TypeError):
        return None


@router.post("/{student_id}/kb-digest")
def kb_digest(
    student_id: str,
    data: DigestRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """Propose durable new facts from the conversation + undigested raw entries.

    Does NOT persist anything — returns proposals for the tutor to approve/edit,
    plus the candidate entry ids that would be archived on merge.
    """
    if not data.apiKey:
        raise HTTPException(status_code=400, detail="API key required")
    _verify_student(db, student_id, tutor.id)

    entries = (
        db.query(models.StudentKnowledgeEntry)
        .filter(
            models.StudentKnowledgeEntry.student_id == student_id,
            models.StudentKnowledgeEntry.digested_at.is_(None),
        )
        .order_by(models.StudentKnowledgeEntry.created_at.asc())
        .all()
    )
    entry_block = "\n".join(f"- {e.content}" for e in entries) or "（无未消化原料）"
    convo = "\n".join(f"{m.role}: {m.content}" for m in data.messages) or "（无对话）"

    prompt = (
        "你是资深 EPQ 辅导专家，正在帮导师做『知识沉淀』。下面是本次与 AI 的对话，以及尚未消化的原料碎片。\n"
        "请提炼出【值得长期保留的耐久事实】——即对未来辅导这名学生有持续价值的判断、背景、偏好或约束，例如："
        "研究兴趣与倾向、能力短板、动力状态、家庭/时间约束、选题方向、关键决定。\n"
        "排除：临时性内容、单次对话的过程性讨论、结构化档案里已有的客观数据、重复信息。\n"
        "每条独立、具体、自包含（脱离本次对话也能看懂）。宁缺毋滥；若无值得沉淀的，返回空数组 []。\n\n"
        f"## 未消化原料\n{entry_block}\n\n## 本次对话\n{convo}\n\n"
        "只输出一个 JSON 字符串数组，不要输出其它任何内容。"
        "例如：[\"该生对量化方法有抵触，倾向定性研究\", \"家长希望8月前完成初稿\"]"
    )

    students = ensure_all_aliases(db, tutor.id)
    mappings = build_name_mappings(students)

    from app.routers.ai import _call_provider
    reply = _call_provider(
        [{"role": "user", "content": encode_names(prompt, mappings)}],
        data.apiKey, data.model, data.baseUrl, data.maxTokens,
    )
    decoded = decode_names(reply, mappings)
    proposals = _extract_json_array(decoded)

    return {
        "proposals": proposals if proposals is not None else [],
        "rawReply": None if proposals is not None else decoded,  # non-null = parse failed, handle manually
        "entryIds": [e.id for e in entries],
    }


@router.post("/{student_id}/living-summary/merge")
def merge_living_summary(
    student_id: str,
    data: MergeRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """Fold approved facts into the current Living Summary — returns a PREVIEW.

    Nothing is persisted here. The client shows the new version to the tutor;
    on confirmation it calls PUT living-summary (with digestedEntryIds) to land
    the change and archive the raw entries atomically.
    """
    if not data.apiKey:
        raise HTTPException(status_code=400, detail="API key required")
    if not data.approvedFacts:
        raise HTTPException(status_code=400, detail="No approved facts")
    _verify_student(db, student_id, tutor.id)

    row = (
        db.query(models.StudentLivingSummary)
        .filter(models.StudentLivingSummary.student_id == student_id)
        .first()
    )
    current = (row.content if row else "") or "（当前活总结为空）"
    facts_block = "\n".join(f"- {f}" for f in data.approvedFacts)

    prompt = (
        "你是资深 EPQ 辅导专家，负责维护这名学生的『活总结』——一份不断进化、代表导师当前对该生完整理解的长文本，"
        "是每次规划辅导的地基。请把下列【新增耐久事实】自然融入现有活总结：\n"
        "- 整合而非堆叠：归类到合适主题下（如 选题 / 能力 / 动力 / 约束 / 进度判断），而不是简单追加到末尾。\n"
        "- 去重、消解冲突：以新事实为准，删除被推翻的旧表述。\n"
        "- 保持精炼、有条理的 Markdown；聚焦对辅导有用的信息，去掉冗余。\n\n"
        f"## 现有活总结\n{current}\n\n## 新增耐久事实\n{facts_block}\n\n"
        "只输出合并后的完整活总结全文，不要输出解释或额外内容。"
    )

    students = ensure_all_aliases(db, tutor.id)
    mappings = build_name_mappings(students)

    from app.routers.ai import _call_provider
    reply = _call_provider(
        [{"role": "user", "content": encode_names(prompt, mappings)}],
        data.apiKey, data.model, data.baseUrl, data.maxTokens,
    )
    merged = decode_names(reply, mappings)
    return {"merged": merged, "previous": row.content if row else ""}
