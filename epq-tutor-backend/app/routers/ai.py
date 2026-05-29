import re
import requests as http
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app import models
from app.auth import get_current_tutor

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ProxyRequest(BaseModel):
    prompt: str
    apiKey: str
    model: str = "qwen-plus"
    baseUrl: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    maxTokens: int = 1024


def _build_alias_maps(students: list) -> tuple[dict, dict]:
    """Build name→alias and alias→name maps. Longer names first to avoid partial replacement."""
    LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    aliases: dict[str, str] = {}
    reverse: dict[str, str] = {}
    for i, s in enumerate(students):
        alias = f"学生{LETTERS[i] if i < 26 else i}"
        if s.name:
            aliases[s.name] = alias
            reverse[alias] = s.name
        if s.name_en:
            aliases[s.name_en] = alias
    return aliases, reverse


def _replace_names(text: str, name_map: dict) -> str:
    # Sort by length descending — replace longer names first to avoid partial clobbering
    for name in sorted(name_map, key=len, reverse=True):
        if name:
            text = text.replace(name, name_map[name])
    return text


def _decode_bare_letters(text: str, reverse: dict) -> str:
    """Decode bare capital letters (e.g. 'D') that AI emitted without '学生' prefix.
    Only matches letters NOT adjacent to other Latin letters, so 'ALevel' is safe."""
    for alias, real_name in reverse.items():
        letter = alias.replace('学生', '')
        if len(letter) == 1 and letter.isupper():
            # (?<![A-Za-z]) and (?![A-Za-z]) prevent matching inside words like ALevel
            text = re.sub(rf'(?<![A-Za-z]){re.escape(letter)}(?![A-Za-z])', real_name, text)
    return text


@router.post("/proxy")
def ai_proxy(
    data: ProxyRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    if not data.apiKey:
        raise HTTPException(status_code=400, detail="API key required")

    # Build alias map from all students belonging to this tutor
    students = (
        db.query(models.Student.name, models.Student.name_en)
        .filter(models.Student.tutor_id == tutor.id)
        .all()
    )
    aliases, reverse = _build_alias_maps(students)

    # Anonymise prompt
    anon_prompt = _replace_names(data.prompt, aliases)

    # Call AI provider
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
                "messages": [{"role": "user", "content": anon_prompt}],
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
        # Reasoning models (e.g. deepseek-v4-flash) put output in reasoning_content
        # when content is empty
        content: str = msg.get("content") or msg.get("reasoning_content") or ""
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail=f"Unexpected AI response: {str(result)[:200]}")

    # Decode aliases back to real names
    decoded = _replace_names(content, reverse)
    decoded = _decode_bare_letters(decoded, reverse)

    return {"content": decoded}
