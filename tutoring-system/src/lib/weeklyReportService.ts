import { getSettings } from './settings'
import { apiFetch } from './githubClient'
import { API_BASE_URL } from '@/config'

export const DEFAULT_WEEKLY_OUTPUT_TEMPLATE = `请严格按以下格式输出，不要任何多余的解释或前言：

📊 导师周报 · {{today}}

[总结段：2-4句话，概括整体进展，指出最需要关注的重点]

━━━ 行动建议 ━━━
📅 尚未预约SA会议（建议本周联系）：[学生姓名，逗号分隔；无则写"暂无"]
⚠️ SA课时剩余≤3次：[学生姓名；无则写"暂无"]
🎓 考试/考季结束，可约课：[根据"可用时间备注"、"最新时间安排"和{{today}}对比判断；无则写"暂无"]
📚 理论课刚结束，可跟进：[根据"可用时间备注"和{{today}}对比判断；无则写"暂无"]
⏸️ 暂缓催促（考试中/备考期）：[根据"最新时间安排"判断当前{{today}}处于考试区间的学生；无则写"暂无"]
🔔 本周可催促推进项目：[排除暂缓学生后，里程碑有停滞或作业未交的学生；无则写"暂无"]
🆕 新学生，尚未开始任何会议：[无则写"暂无"]
🔄 里程碑长期停滞（进行中超过预期）：[无则写"暂无"]
✅ 进展顺利，无需特别跟进：[其余学生]`
import { EPQ_MILESTONES } from '@/config'
import { getWeeklyReportData, saveWeeklyReportData } from './dataService'
import type { Student, StudentReportCacheEntry, WeeklyReportData } from '@/types'
import { isSessionStarted } from './formatters'


// ── Student data summariser ───────────────────────────────────────────────────

function summariseStudent(s: Student, _today: string, changed: boolean): string {
  const pastSA = s.sessions
    .filter(x => x.type === 'SA_MEETING' && isSessionStarted(x))
    .sort((a, b) => b.date.localeCompare(a.date))

  const saUsed = pastSA.length
  const saRemaining = s.saHoursTotal - saUsed
  const lastSA = pastSA[0]
  const daysSinceLastSA = lastSA
    ? Math.floor((Date.now() - new Date(lastSA.date).getTime()) / 86_400_000)
    : null

  const nextSA = s.sessions
    .filter(x => x.type === 'SA_MEETING' && !isSessionStarted(x))
    .sort((a, b) => a.date.localeCompare(b.date))[0]

  // Milestones
  const applicable = EPQ_MILESTONES.filter(m => s.milestones[m.id] !== 'na')
  const completedCount = applicable.filter(m => s.milestones[m.id] === 'completed').length
  const inProgress = applicable.filter(m => s.milestones[m.id] === 'in_progress')
  const milestoneStr = applicable.length
    ? `${completedCount}/${applicable.length} 已完成${inProgress.length ? `，进行中：${inProgress.map(m => m.label).join('、')}` : ''}`
    : '暂无里程碑数据'

  const lines = [
    `年级：${s.currentGrade ?? '未填'} | 提交轮次：${s.submissionRound ?? '未填'}`,
    `SA课时：已用 ${saUsed}/${s.saHoursTotal}，剩余 ${saRemaining} 次`,
    `上次SA：${lastSA ? `${lastSA.date}（${daysSinceLastSA} 天前）` : '暂无'}`,
    `下次预约SA：${nextSA ? nextSA.date : '无'}`,
    `可用时间备注：${s.availabilityNote || '无'}`,
    `最新时间安排：${s.scheduleEntries?.[0] ? `[${s.scheduleEntries[0].recordedAt}] ${s.scheduleEntries[0].content}` : '无'}`,
    `里程碑：${milestoneStr}`,
  ]

  if (changed && lastSA?.summary) lines.push(`最近SA摘要：${lastSA.summary.slice(0, 100)}`)
  if (changed && lastSA?.homework) lines.push(`最近作业：${lastSA.homework.slice(0, 80)}`)
  if (!changed) lines.push('（自上次周报以来无变化）')

  return lines.join('\n')
}

// ── AI call — routes through backend proxy for server-side anonymisation ──────

async function callAI(prompt: string): Promise<string> {
  const { aiApiKey, aiModel, aiBaseUrl } = getSettings()
  if (!aiApiKey) throw new Error('请先在设置页面填写 API Key')

  // Use backend proxy: anonymises student names before forwarding to AI provider,
  // then decodes aliases in the response. The AI provider never sees real names.
  const res = await apiFetch(`${API_BASE_URL}/ai/proxy`, {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      apiKey: aiApiKey,
      model: aiModel || 'qwen-plus',
      baseUrl: aiBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      maxTokens: 1024,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail = (err as Record<string, unknown>)?.detail
    const msg = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? (detail as { msg?: string }[]).map(d => d.msg).join('; ')
        : `API 错误 ${res.status}`
    throw new Error(msg)
  }

  const data = await res.json() as { content: string }
  return data.content
}

// ── Main export ───────────────────────────────────────────────────────────────

export { getWeeklyReportData }

export async function generateWeeklyReport(students: Student[]): Promise<WeeklyReportData> {
  const today = new Date().toISOString().slice(0, 10)

  // 1. Load existing cache (updatedAt snapshots for change detection)
  const existing = await getWeeklyReportData()
  const existingCache = existing?.cache.students ?? {}

  // 2. Determine which students changed since last scan
  const changedIds = new Set(
    students
      .filter(s => !existingCache[s.id] || existingCache[s.id].updatedAt !== s.updatedAt)
      .map(s => s.id),
  )

  // 3. Build prompt sections with real names
  const studentSections = students
    .map(s => {
      const changed = changedIds.has(s.id)
      return `【${s.name}${s.nameEn ? ` · ${s.nameEn}` : ''}】${changed ? '' : ' (无变化)'}\n${summariseStudent(s, today, changed)}`
    })
    .join('\n\n')

  const { weeklyReportOutputTemplate } = getSettings()
  const outputTemplate = (weeklyReportOutputTemplate || DEFAULT_WEEKLY_OUTPUT_TEMPLATE)
    .replaceAll('{{today}}', today)
    .replaceAll('{{studentCount}}', String(students.length))
    .replaceAll('{{changedCount}}', String(changedIds.size))

  const prompt = `你是EPQ学术导师的周报助手。请根据以下所有学生的进度数据，生成一份供导师自己阅读的中文周报。

今天日期：${today}
学生总数：${students.length}人，本次有变化：${changedIds.size}人

━━━ 学生数据 ━━━
${studentSections}

━━━ 输出要求 ━━━
${outputTemplate}`

  // 4. Call AI (guard against excessively long prompts)
  const MAX_PROMPT_CHARS = 12000
  const trimmedPrompt = prompt.length > MAX_PROMPT_CHARS
    ? prompt.slice(0, MAX_PROMPT_CHARS) + '\n\n[部分学生数据因长度限制被截断，请根据已有数据生成报告]'
    : prompt
  const content = await callAI(trimmedPrompt)

  // 5. Build updated cache
  const newStudentCache: Record<string, StudentReportCacheEntry> = {}
  for (const s of students) {
    newStudentCache[s.id] = { updatedAt: s.updatedAt }
  }

  const result: WeeklyReportData = {
    generatedAt: new Date().toISOString(),
    content,
    cache: { lastScanAt: new Date().toISOString(), students: newStudentCache },
  }

  // 6. Persist
  await saveWeeklyReportData(result)

  return result
}
