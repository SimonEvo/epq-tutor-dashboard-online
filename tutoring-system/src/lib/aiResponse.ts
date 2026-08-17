/** Shape of an OpenAI-compatible chat-completions reply (DeepSeek adds reasoning_content). */
interface ChatCompletion {
  choices?: {
    message?: { content?: string; reasoning_content?: string }
    finish_reason?: string
  }[]
}

/**
 * Pull the assistant text out of a chat-completions response.
 *
 * Reasoning models (deepseek-v4-pro, deepseek-reasoner) stream their chain of
 * thought into `reasoning_content` and only start filling `content` once the
 * thinking is done. A max_tokens budget too small for the chain of thought
 * therefore yields HTTP 200 with an empty `content` and finish_reason "length"
 * — a success as far as fetch is concerned. Fall back to reasoning_content, and
 * throw instead of returning '' so the failure is visible in the UI.
 */
export function extractContent(data: unknown): string {
  const choice = (data as ChatCompletion)?.choices?.[0]
  if (!choice?.message) {
    throw new Error(`AI 响应结构异常：${JSON.stringify(data).slice(0, 200)}`)
  }

  const content = choice.message.content?.trim() || ''
  if (content) return content

  // Truncated mid-thought: reasoning_content holds only a fragment of the chain
  // of thought, never the answer, so surfacing it would render nonsense as a report.
  if (choice.finish_reason === 'length') {
    throw new Error(
      'AI 返回内容为空：max_tokens 被思维链占满，模型还没开始写正文就被截断。' +
      '推理模型（deepseek-v4-pro / deepseek-reasoner）不适合本场景，请在设置页把模型改为 deepseek-v4-flash。',
    )
  }

  // Finished normally but wrote everything into reasoning_content — that is the answer.
  const reasoning = choice.message.reasoning_content?.trim() || ''
  if (reasoning) return reasoning

  throw new Error(`AI 返回内容为空（finish_reason: ${choice.finish_reason ?? '未知'}）`)
}
