import type { Student, ChecklistTemplateItem } from '@/types'

/** 第 3 次起标红警示（不阻断） */
export const TII_LIMIT = 3

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** "2026-08-14T17:00" → "08.14 五 17:00"；空 → "待定" */
export function formatDeadline(iso?: string | null): string {
  if (!iso) return '待定'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}.${dd} ${WEEKDAY[d.getDay()]} ${hh}:${mi}`
}

/** 倒计时文案：「还剩 3天2h」/「还剩 5h」/「已逾期 2天」；无 ddl → '' */
export function formatCountdown(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = d.getTime() - now.getTime()
  const overdue = diffMs < 0
  const totalHours = Math.floor(Math.abs(diffMs) / 3600000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const text = days > 0 ? `${days}天${hours}h` : `${hours}h`
  return overdue ? `已逾期 ${text}` : `还剩 ${text}`
}

export function isOverdue(iso?: string | null, now: Date = new Date()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime()
}

/** 模板活跃项（归档项不出列） */
export function activeTemplateItems(template: ChecklistTemplateItem[]): ChecklistTemplateItem[] {
  return template.filter(i => !i.archived).sort((a, b) => a.order - b.order)
}

export function isTicked(student: Student, itemId: string): boolean {
  return !!student.submissionChecklist?.ticked?.[itemId]
}

/** 未完成项数 = 未打钩模板项 + 未完成表13证据 */
export function pendingCount(student: Student, template: ChecklistTemplateItem[]): number {
  const items = activeTemplateItems(template)
  const unticked = items.filter(i => !isTicked(student, i.id)).length
  const custom = (student.submissionChecklist?.customItems ?? []).filter(c => !c.done).length
  return unticked + custom
}

/**
 * 提交视图排序：有效 ddl 升序 → 同 ddl 按姓名 → ddl 待定排最后。
 * 结项沉底由调用方分组处理。
 *
 * 刻意**不**按完成进度排序：打一个钩就跳一次行，正在操作的那行会跑掉。
 */
export function compareForSprint(a: Student, b: Student): number {
  const da = a.effectiveDeadline || ''
  const db = b.effectiveDeadline || ''
  if (!da && !db) return a.name.localeCompare(b.name)
  if (!da) return 1
  if (!db) return -1
  if (da !== db) return da < db ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** 最终答辩 session —— 取 isFinalDefense 的（多条取最晚一条）；没有 → undefined */
export function finalDefenseSession(student: Student) {
  return (student.sessions ?? [])
    .filter(x => x.isFinalDefense)
    .sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`))
    .pop()
}

/** 最终答辩时间文案："08.05 周三 14:00"；没排 session → undefined */
export function finalDefenseLabel(student: Student): string | undefined {
  const sess = finalDefenseSession(student)
  if (!sess) return undefined
  // 纯日期串走 new Date() 会被当 UTC 解析而偏移，统一补上本地时间再格式化
  const label = formatDeadline(`${sess.date}T${sess.time || '00:00'}`)
  return sess.time ? label : label.replace(/ \d{2}:\d{2}$/, '')
}

// ── 已结项分组的展开状态 ───────────────────────────────────────────────────────
// 甘特图与提交视图共用一个 key —— 一处展开，切到另一个视图也是展开的。

const WRAPPED_OPEN_KEY = 'wrapped-open'

export function getWrappedOpen(): boolean {
  return localStorage.getItem(WRAPPED_OPEN_KEY) === '1'
}

export function setWrappedOpen(open: boolean): void {
  localStorage.setItem(WRAPPED_OPEN_KEY, open ? '1' : '0')
}
