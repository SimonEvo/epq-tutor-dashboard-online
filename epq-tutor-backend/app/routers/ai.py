import requests as http
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_tutor
from app.database import get_db
from app import models
from app.name_encoding import build_name_mappings, encode_names, decode_names

router = APIRouter(prefix="/api/ai", tags=["ai"])

# DeepSeek default for Knowledge Base chat (baseUrl points at DeepSeek via config).
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"


class ProxyRequest(BaseModel):
    prompt: str
    apiKey: str
    model: str = "qwen-plus"
    baseUrl: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    maxTokens: int = 1024


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    studentId: str
    messages: list[ChatMessage]
    apiKey: str
    model: str = "deepseek-v4"
    baseUrl: str = DEEPSEEK_BASE_URL
    maxTokens: int = 4096


@router.post("/proxy")
def ai_proxy(
    data: ProxyRequest,
    _tutor=Depends(get_current_tutor),
):
    if not data.apiKey:
        raise HTTPException(status_code=400, detail="API key required")

    base = data.baseUrl.rstrip("/")
    try:
        resp = http.post(
            f"{base}/chat/completions",
            headers={
                "Authorization": f"Bearer {data.apiKey}",
                "Content-Type": "application/json",
            },
            json={
                "model": data.model,
                "messages": [{"role": "user", "content": data.prompt}],
                "max_tokens": data.maxTokens,
            },
            timeout=60,
        )
        resp.raise_for_status()
    except http.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    result = resp.json()
    try:
        msg = result["choices"][0]["message"]
        content: str = msg.get("content") or msg.get("reasoning_content") or ""
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail=f"Unexpected AI response: {str(result)[:200]}")

    return {"content": content}


def _call_provider(messages: list[dict], api_key: str, model: str, base_url: str, max_tokens: int) -> str:
    """POST a chat-completions request and return the assistant text."""
    base = base_url.rstrip("/")
    try:
        resp = http.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages, "max_tokens": max_tokens},
            timeout=120,  # long context can be slow
        )
        resp.raise_for_status()
    except http.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"AI provider error: {e}")

    result = resp.json()
    try:
        msg = result["choices"][0]["message"]
        return msg.get("content") or msg.get("reasoning_content") or ""
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail=f"Unexpected AI response: {str(result)[:200]}")


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
    if not data.apiKey:
        raise HTTPException(status_code=400, detail="API key required")

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
    reply = _call_provider(encoded_messages, data.apiKey, data.model, data.baseUrl, data.maxTokens)
    return {"content": decode_names(reply, mappings)}
