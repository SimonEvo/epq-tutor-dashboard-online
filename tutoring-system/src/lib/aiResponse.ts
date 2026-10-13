/** Shape of an OpenAI-compatible chat-completions reply (DeepSeek adds reasoning_content). */
interface ChatCompletion {
  choices?: {
    message?: { content?: string; reasoning_content?: string }
    finish_reason?: string
  }[]
}

/**
 * Build a single-turn chat-completions request body.
 *
 * DeepSeek models (deepseek-flash, deepseek-v4-pro, legacy deepseek-v4-flash …)
 * are hybrid and default to thinking mode; the chain of thought counts against
 * max_tokens, which is how even flash came back empty. Turn it off explicitly
 * for any deepseek-* model — matching only "deepseek-v4" missed the current
 * official name deepseek-flash. Not for other providers (qwen etc.), which may
 * reject the unknown field, nor deepseek-reasoner, which is thinking-only.
 * Mirrors `_request_body` in epq-tutor-backend/app/routers/ai.py.
 */
export function buildChatBody(model: string, prompt: string, maxTokens: number) {
  const m = model.toLowerCase()
  const hybridDeepSeek = m.startsWith('deepseek') && m !== 'deepseek-reasoner'
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    ...(hybridDeepSeek ? { thinking: { type: 'disabled' } } : {}),
  }
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
      'deepseek-reasoner 只有思考模式，不适合本场景，请在设置页把模型改为 deepseek-flash。',
    )
  }

  // Finished normally but wrote everything into reasoning_content — that is the answer.
  const reasoning = choice.message.reasoning_content?.trim() || ''
  if (reasoning) return reasoning

  throw new Error(`AI 返回内容为空（finish_reason: ${choice.finish_reason ?? '未知'}）`)
}
