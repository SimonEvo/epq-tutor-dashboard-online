import { getSettings } from './settings'
import type { ActionLog, ManualLog } from '@/types'

// ── AI call ───────────────────────────────────────────────────────────────────

async function callAI(prompt: string): Promise<string> {
  const { aiApiKey, aiModel, aiBaseUrl } = getSettings()
  if (!aiApiKey) throw new Error('请先在设置页面填写 API Key')
  const base = (aiBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${aiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: aiModel || 'qwen-plus',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = (err as { error?: { message?: string } })?.error?.message
    throw new Error(msg ?? `API 错误 ${res.status}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content
}


// ── Summarisation helpers ────────────────────────────────────────────────────

function summariseActions(actions: ActionLog[]): string {
  // Group by action+entityType
  const counts: Record<string, number> = {}
  for (const a of actions) {
    const key = `${a.action} ${a.entityType}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  const lines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `- ${k}: ${n} 次`)
  return lines.join('\n')
}

function summariseTimePattern(actions: ActionLog[]): string {
  // Bucket by day of week (0=Sun) and hour of day
  const byDow = [0, 0, 0, 0, 0, 0, 0]
  const byHour: Record<number, number> = {}
  for (const a of actions) {
    const d = new Date(a.timestamp)
    byDow[d.getDay()] += 1
    byHour[d.getHours()] = (byHour[d.getHours()] ?? 0) + 1
  }
  const dowNames = ['日', '一', '二', '三', '四', '五', '六']
  const dowLine = '操作 by 星期: ' + dowNames.map((n, i) => `${n}=${byDow[i]}`).join(', ')
  const hours = Object.entries(byHour).sort((a, b) => Number(a[0]) - Number(b[0]))
  const hourLine = '操作 by 小时: ' + hours.map(([h, n]) => `${h}时=${n}`).join(', ')
  return `${dowLine}\n${hourLine}`
}

function summariseManualLogs(logs: ManualLog[]): string {
  if (logs.length === 0) return '（无）'
  return logs
    .slice(0, 30) // cap to avoid huge prompts
    .map(l => `- ${l.occurredAt.slice(0, 16)}: ${l.description}`)
    .join('\n')
}


// ── Main export ───────────────────────────────────────────────────────────────

export async function generateWorkflowAnalysis(
  periodStart: string,
  periodEnd: string,
  actions: ActionLog[],
  manualLogs: ManualLog[],
): Promise<string> {
  const periodLabel = `${periodStart.slice(0, 10)} ~ ${periodEnd.slice(0, 10)}`

  const prompt = `你是一名专注于工作流效率的分析助手。我是一名 EPQ 学术导师，使用一个自建系统记录我所有的工作操作。请基于以下两周内的行为数据，分析我的工作模式，并给出提升效率的建议。

【时间窗口】${periodLabel}
【总操作数】${actions.length} 条自动日志 + ${manualLogs.length} 条手动日志

━━━ 自动日志（数据变更与 AI 调用，已按类型聚合）━━━
${summariseActions(actions)}

━━━ 时间模式 ━━━
${summariseTimePattern(actions)}

━━━ 手动日志（我自己描述的工作）━━━
${summariseManualLogs(manualLogs)}

━━━ 输出要求 ━━━
请严格按以下四段格式输出，使用 markdown，不要任何前言或多余解释：

## 📊 操作频率分布
[一段话总结主要操作类型和频次，指出哪类工作占比最高]

## 🕐 时间模式
[一段话总结集中在哪些时段/星期，是否有明显的工作节奏]

## 💡 效率洞察
[3-5 条 bullet，基于上面数据指出可能的低效点或值得保持的好习惯]

## ⚡ 自动化建议
[2-4 条具体的自动化建议，每条说明：1) 哪种操作可以被自动化  2) 触发条件  3) 期望效果]

注意：建议要具体、可执行，避免空泛的鸡汤。`

  const MAX_PROMPT_CHARS = 16000
  const trimmed = prompt.length > MAX_PROMPT_CHARS
    ? prompt.slice(0, MAX_PROMPT_CHARS) + '\n\n[数据过长已截断]'
    : prompt

  return await callAI(trimmed)
}
