"""DeepSeek 混合模型的思考模式必须显式关掉。

DeepSeek 混合模型默认开思考，思维链计入 max_tokens，吃光后正文为空
（flash 也会）。所有 AI 调用都经后端代理，只有这一处构造请求体。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.routers.ai import _request_body  # noqa: E402


def test_hybrid_deepseek_models_disable_thinking():
    # deepseek-flash 是官方现行名字 —— 只匹配 "deepseek-v4" 前缀时漏了它
    for model in ("deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro", "DeepSeek-Flash"):
        assert _request_body([], model, 1024)["thinking"] == {"type": "disabled"}


def test_other_models_get_no_thinking_field():
    """别的 OpenAI 兼容 provider（qwen 等）可能拒收未知字段。"""
    for model in ("deepseek-reasoner", "qwen-plus"):
        assert "thinking" not in _request_body([], model, 1024)
