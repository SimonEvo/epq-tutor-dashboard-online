import type { RoundInfo, Student } from './types'

export const TODAY = new Date('2026-09-21T15:59:00')

export const ROUNDS: RoundInfo[] = [
  { name: '26秋', deadlineNormal: '2027-03-12T17:00', deadlineExtended: '2027-03-19T17:00' },
  { name: '26春', deadlineNormal: '2026-08-14T17:00', deadlineExtended: '2026-08-21T17:00', archived: true },
]

export function parseDate(s: string): Date {
  return new Date(s.replace(' ', 'T'))
}

export function daysSince(isoDate: string): number {
  const d = parseDate(isoDate)
  return Math.floor((TODAY.getTime() - d.getTime()) / 86400000)
}

export function daysUntil(isoDate: string): number {
  const d = parseDate(isoDate)
  return Math.ceil((d.getTime() - TODAY.getTime()) / 86400000)
}

export function fmtDate(iso: string): string {
  const d = parseDate(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function fmtDateFull(iso: string): string {
  const d = parseDate(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fmtDateTime(iso: string): string {
  const d = parseDate(iso)
  return `${fmtDateFull(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h${m}min`
}

/** SA 课次：已上的 SA_MEETING 数量 */
export function saCountUsed(s: Student): number {
  return s.sessions.filter((x) => x.type === 'SA_MEETING').length
}

/** SA 时长：累计分钟 */
export function saMinutesUsed(s: Student): number {
  return s.sessions.filter((x) => x.type === 'SA_MEETING').reduce((a, x) => a + x.durationMinutes, 0)
}

export function lastMeetingDate(s: Student): string | null {
  if (s.sessions.length === 0) return null
  return s.sessions.map((x) => x.date).sort().slice(-1)[0]
}

export function lastTouched(s: Student): number {
  // demo 近似：最近一次课次或 Tii 检测等数据变动
  let latest: string | null = lastMeetingDate(s)
  for (const c of s.tiiChecks.map((x) => x.date)) {
    if (!latest || c > latest) latest = c
  }
  return latest ? Math.max(0, daysSince(latest)) : 999
}

export type Urgency = 'red' | 'amber' | 'green'

export function urgencyOf(s: Student): Urgency {
  const last = lastMeetingDate(s)
  if (!last) return 'red'
  const d = daysSince(last)
  if (d > 10) return 'red'
  if (d > 6) return 'amber'
  return 'green'
}

export function effectiveDeadline(s: Student, rounds: RoundInfo[]): string | null {
  if (s.deadlineOverride) return s.deadlineOverride
  const r = rounds.find((x) => x.name === s.round)
  if (!r) return null
  return s.deadlineTier === 'extended' ? r.deadlineExtended : r.deadlineNormal
}

export function urgencyColor(u: Urgency): string {
  return u === 'red' ? '#ef4444' : u === 'amber' ? '#f59e0b' : '#22c55e'
}

let seq = 0
export function nid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`
}
