"""机构共享的 AI 凭据。

P3 方案 B：凭据存在服务端（system_config 表），前端不再持有、不再传 key。

## 为什么不让客户端继续传 key

1. 传了就等于每个内测老师都得自己去办一个 key —— 多半没人会办，反馈质量受损。
2. 客户端传 key 的调用无法计入用量：浏览器直连 provider 的请求后端根本看不见。
3. key 落在 localStorage 里，换台机器就得重新粘一遍。

所以 `/api/ai/*` **忽略请求体里的 apiKey**（老客户端传了也不认），一律用服务端的。

## 为什么模型和 baseUrl 也收到服务端

原先这两个是每人各自的前端设置。收到机构级有个额外好处：避免某个导师选了推理
模型（deepseek-reasoner 那类）把 max_tokens 全烧在思维链上 —— 那个坑
`ai.py:_extract_content` 里已经踩过并写了专门的报错。
"""
from sqlalchemy.orm import Session

from app import models

KEY_API_KEY = "ai_api_key"
KEY_BASE_URL = "ai_base_url"
KEY_MODEL = "ai_model"

# 未配置时的缺省值。DeepSeek 的 flash 模型不是推理模型，适合本场景。
DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_MODEL = "deepseek-v4-flash"


def get(db: Session, key: str, default: str = "") -> str:
    row = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    return (row.value if row else "") or default


def put(db: Session, key: str, value: str) -> None:
    row = db.query(models.SystemConfig).filter(models.SystemConfig.key == key).first()
    if row is None:
        row = models.SystemConfig(key=key, value=value)
        db.add(row)
    else:
        row.value = value


def resolved(db: Session) -> dict:
    """给 /api/ai/* 用的完整凭据。api_key 可能为空 —— 调用方负责报错。"""
    return {
        "api_key": get(db, KEY_API_KEY),
        "base_url": get(db, KEY_BASE_URL, DEFAULT_BASE_URL),
        "model": get(db, KEY_MODEL, DEFAULT_MODEL),
    }


def key_hint(api_key: str) -> str:
    """给界面看的遮罩形式。只露末四位 —— 足够确认「换对了没」，又不泄漏 key。"""
    if not api_key:
        return ""
    return f"••••{api_key[-4:]}" if len(api_key) > 4 else "••••"


def public_view(db: Session) -> dict:
    """可以回传给客户端的部分。**不含 api_key 明文。**"""
    cfg = resolved(db)
    return {
        "configured": bool(cfg["api_key"]),
        "keyHint": key_hint(cfg["api_key"]),
        "baseUrl": cfg["base_url"],
        "model": cfg["model"],
    }
