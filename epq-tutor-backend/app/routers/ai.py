import requests as http
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_tutor
from app.action_logger import log_action
from app.database import get_db
from app import ai_config, models
from app.name_encoding import build_name_mappings, encode_names, decode_names

router = APIRouter(prefix="/api/ai", tags=["ai"])

# DeepSeek default for Knowledge Base chat (baseUrl points at DeepSeek via config).
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"


def _credentials(db: Session) -> dict:
    cfg = ai_config.resolved(db)
    if not cfg["api_key"]:
        raise HTTPException(
            status_code=503,
            detail="系统还没有配置 AI 凭据，请联系管理员在「账号管理 → AI 配置」里填写。",
        )
    return cfg


def _record(db: Session, tutor: models.Tutor, kind: str) -> None:
    """按人记一次 AI 调用。只观测不拦 —— 配额限制目前不做。

    记在这里而不是各业务端点：AI 调用全部经过本模块，这是唯一能数全的地方。
    """
    log_action(db, tutor, "ai_generate", "ai_call", "", {"kind": kind})
    db.commit()


class ProxyRequest(BaseModel):
    """凭据不在请求体里 —— 由服务端的机构配置决定（P3 方案 B，见 app/ai_config.py）。

    老客户端仍会传 apiKey / model / baseUrl，pydantic 默认忽略多余字段，
    这里刻意不接收：接收了就等于允许绕过用量统计。
    """
    prompt: str
    maxTokens: int = 1024


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    studentId: str
    messages: list[ChatMessage]
    maxTokens: int = 4096


@router.post("/proxy")
def ai_proxy(
    data: ProxyRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    cfg = _credentials(db)
    content = _call_provider(
        [{"role": "user", "content": data.prompt}],
        cfg["api_key"], cfg["model"], cfg["base_url"], data.maxTokens,
    )
    _record(db, tutor, "proxy")
    return {"content": content}


def _is_hybrid_deepseek(model: str) -> bool:
    m = model.lower()
    return m.startswith("deepseek") and m != "deepseek-reasoner"


def _request_body(messages: list[dict], model: str, max_tokens: int) -> dict:
    """Build the chat-completions payload.

    DeepSeek models (deepseek-flash, deepseek-v4-pro, legacy deepseek-v4-flash …)
    are hybrid and default to thinking mode; the chain of thought counts against
    max_tokens, which is how even flash came back empty. Turn it off explicitly
    for any deepseek-* model — matching only "deepseek-v4" missed the current
    official name deepseek-flash. Not for other providers (qwen etc.), which may
    reject the unknown field, nor deepseek-reasoner, which is thinking-only.
    """
    body = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if _is_hybrid_deepseek(model):
        body["thinking"] = {"type": "disabled"}
    return body


def _extract_content(result: dict) -> str:
    """Pull the assistant text out of a chat-completions payload.

    Reasoning models (deepseek-v4-pro / deepseek-reasoner) fill reasoning_content
    first and only write content once the thinking finishes, so a max_tokens
    budget eaten by the chain of thought comes back as HTTP 200 with an empty
    content. Fall back to reasoning_content, and 502 rather than hand the client
    an empty string it would silently render as a blank report.
    """
    try:
        choice = result["choices"][0]
        msg = choice["message"]
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail=f"Unexpected AI response: {str(result)[:200]}")

    content = (msg.get("content") or "").strip()
    if content:
        return content

    # Truncated mid-thought: reasoning_content holds only a fragment of the chain
    # of thought, never the answer, so surfacing it would render nonsense as a report.
    if choice.get("finish_reason") == "length":
        raise HTTPException(
            status_code=502,
            detail="AI 返回内容为空：max_tokens 被思维链占满，模型还没开始写正文就被截断。"
                   "请在设置页把模型改为 deepseek-flash（deepseek-reasoner 只有思考模式，不适合本场景）。",
        )

    # Finished normally but wrote everything into reasoning_content — that is the answer.
    reasoning = (msg.get("reasoning_content") or "").strip()
    if reasoning:
        return reasoning

    raise HTTPException(
        status_code=502,
        detail=f"AI 返回内容为空（finish_reason: {choice.get('finish_reason', '未知')}）",
    )


def _call_provider(messages: list[dict], api_key: str, model: str, base_url: str, max_tokens: int) -> str:
    """POST a chat-completions request and return the assistant text."""
    base = base_url.rstrip("/")
    try:
        resp = http.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=_request_body(messages, model, max_tokens),
            timeout=120,  # long context can be slow
        )
        resp.raise_for_status()
    except http.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    return _extract_content(resp.json())


@router.post("/chat")
def ai_chat(
    data: ChatRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    """Multi-turn Knowledge Base chat. THE single AI-boundary for name encoding.

    Outbound: every message's content is encoded (real names -> aliases).
    Inbound: the assistant reply is decoded (aliases -> real names) before return.
    Chat is NOT persisted server-side; the client holds the running message array
    and sends the whole thing each turn.
    """
    cfg = _credentials(db)

    student = (
        db.query(models.Student)
        .filter(models.Student.id == data.studentId, models.Student.tutor_id == tutor.id)
        .first()
    )
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    # Backfill any missing aliases so no real name can leak, then build mappings
    # across ALL of the tutor's students (covers cross-mentions in the context).
    from app.routers.knowledge import ensure_all_aliases
    students = ensure_all_aliases(db, tutor.id)
    mappings = build_name_mappings(students)

    encoded_messages = [
        {"role": m.role, "content": encode_names(m.content, mappings)} for m in data.messages
    ]
    reply = _call_provider(
        encoded_messages, cfg["api_key"], cfg["model"], cfg["base_url"], data.maxTokens,
    )
    _record(db, tutor, "kb_chat")
    return {"content": decode_names(reply, mappings)}


@router.get("/status")
def ai_status(db: Session = Depends(get_db), _tutor=Depends(get_current_tutor)):
    """任何导师都能查：AI 是否可用、用的哪个模型。不含 key，也不含 baseUrl。"""
    view = ai_config.public_view(db)
    return {"configured": view["configured"], "model": view["model"]}
