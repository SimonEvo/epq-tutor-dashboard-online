"""DeepSeek V4 思考模式必须显式关掉。

V4 混合模型默认可能开思考，思维链计入 max_tokens，吃光后正文为空
（deepseek-v4-flash 也会）。前端 aiResponse.ts:buildChatBody 是同一逻辑。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.routers.ai import _request_body  # noqa: E402


def test_v4_models_disable_thinking():
    for model in ("deepseek-v4-flash", "deepseek-v4-pro"):
        assert _request_body([], model, 1024)["thinking"] == {"type": "disabled"}


def test_non_v4_models_get_no_thinking_field():
    """别的 OpenAI 兼容 provider（qwen 等）可能拒收未知字段。"""
    for model in ("deepseek-reasoner", "qwen-plus"):
        assert "thinking" not in _request_body([], model, 1024)
