/**
 * Returns true if the session has already started, considering both date and time.
 * For today's sessions with a time field, compares current CST time to session start time.
 * Sessions without a time field on today are treated as started.
 */
export function isSessionStarted(s: { date: string; time?: string }): boolean {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  if (s.date < todayStr) return true
  if (s.date > todayStr) return false
  if (!s.time) return true
  const nowHHMM = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
  })
  return nowHHMM >= s.time
}

/**
 * True if a session counts toward the SA hour quota. Excludes 最终答辩 SA
 * sessions (isFinalDefense) — those are shown on the Gantt but never consume
 * SA hours. Use this everywhere an SA workload/quota count is computed.
 */
export function countsAsSaHour(s: { type: string; isFinalDefense?: boolean }): boolean {
  return s.type === 'SA_MEETING' && !s.isFinalDefense
}

// ── Resit ─────────────────────────────────────────────────────────────────────
// resit 是另一次提交：SA 额度、最终答辩都只看当前这一次的课。
// 之前那次的课仍留在 sessions 里（课程记录是真实发生过的），只是不再计数。

type AttemptAware = { currentAttempt?: number }

/** 课属于学生当前这次提交。没带 attempt 的（刚建、还没回存）视为当前 */
export function inCurrentAttempt(s: { attempt?: number }, student: AttemptAware): boolean {
  const current = student.currentAttempt ?? 1
  return (s.attempt ?? current) === current
}

/** 计入当前 SA 额度的课（不含答辩、不含之前那次提交的课） */
export function currentSaSessions<T extends { type: string; isFinalDefense?: boolean; attempt?: number }>(
  student: AttemptAware & { sessions: T[] },
): T[] {
  return student.sessions.filter(s => countsAsSaHour(s) && inCurrentAttempt(s, student))
}

export function isResit(student: AttemptAware): boolean {
  return (student.currentAttempt ?? 1) > 1
}

/** 学生在该轮次里显示：当前提交轮次，或之前某次提交所在的轮次 */
export function inRound(student: { submissionRound?: string; previousRounds?: string[] }, round: string): boolean {
  return student.submissionRound === round || (student.previousRounds ?? []).includes(round)
}

/** 该轮次对这名学生来说已经交过了（学生已转去 resit 轮次） */
export function submittedInRound(student: { submissionRound?: string; previousRounds?: string[] }, round: string): boolean {
  return student.submissionRound !== round && (student.previousRounds ?? []).includes(round)
}

/** 学生在某轮次对应的是第几次提交；不在该轮次 → undefined */
export function attemptForRound(
  student: AttemptAware & { submissionRound?: string; previousRounds?: string[] },
  round: string,
): number | undefined {
  if (student.submissionRound === round) return student.currentAttempt ?? 1
  const i = (student.previousRounds ?? []).indexOf(round)
  return i >= 0 ? i + 1 : undefined
}

/** Copy text to clipboard with textarea fallback for non-HTTPS environments. */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

/** Format decimal hours as xhxxmin. e.g. 1.5 → "1h30min", 0.75 → "45min", 2 → "2h" */
export function formatHours(decimalHours: number): string {
  const totalMins = Math.round(decimalHours * 60)
  const h = Math.floor(totalMins / 60)
  const min = totalMins % 60
  if (h === 0) return `${min}min`
  if (min === 0) return `${h}h`
  return `${h}h${min}min`
}
