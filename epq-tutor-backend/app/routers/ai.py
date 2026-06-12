import requests as http
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth import get_current_tutor

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ProxyRequest(BaseModel):
    prompt: str
    apiKey: str
    model: str = "qwen-plus"
    baseUrl: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    maxTokens: int = 1024


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
