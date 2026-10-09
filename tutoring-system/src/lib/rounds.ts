/**
 * 轮次（学期）推导 —— 与后端 app/rounds.py 同规则。
 *
 * 这里只服务两件事：编辑表单里由报名轮次自动填提交轮次，以及界面上的提交时间提示。
 * 权威解析在后端（导入和保存都会归一），前端算错最多是预填不准，不会写坏数据。
 *
 * 标签格式：`25秋` = 2025 秋季开课、2026 年 3 月提交；`26春` = 2026 年 2 月开课、
 * 当年 8 月提交。正则同时吃教务系统的长格式 `25秋季（26年3月提交）`。
 */

export type Season = 'spring' | 'autumn'

const ROUND_RE = /(?<!\d)(\d{2}|\d{4})\s*年?\s*(春|秋)/

export function parseRound(label?: string | null): { year: number; season: Season } | null {
  if (!label) return null
  const m = ROUND_RE.exec(label.trim())
  if (!m) return null
  const raw = Number(m[1])
  const year = raw < 100 ? 2000 + raw : raw
  if (year < 2000 || year > 2100) return null
  return { year, season: m[2] === '春' ? 'spring' : 'autumn' }
}

export function formatRound(year: number, season: Season): string {
  return `${String(year % 100).padStart(2, '0')}${season === 'spring' ? '春' : '秋'}`
}

/** 下一轮：春 → 同年秋；秋 → 次年春 */
export function nextRound(label?: string | null): string | null {
  const p = parseRound(label)
  if (!p) return null
  return p.season === 'spring'
    ? formatRound(p.year, 'autumn')
    : formatRound(p.year + 1, 'spring')
}

/** 识别不了就原样返回 —— 不吞掉用户自己填的批次名 */
export function normalizeRound(label?: string | null): string {
  const p = parseRound(label)
  return p ? formatRound(p.year, p.season) : (label ?? '')
}

/** 由报名轮次推提交轮次。一年期顺延一轮，其余相同。 */
export function deriveSubmissionRound(registrationRound?: string | null, isOneYear = false): string {
  const reg = normalizeRound(registrationRound)
  if (!reg) return ''
  return isOneYear ? (nextRound(reg) ?? reg) : reg
}

/** `25秋` → `26年3月提交`，给界面做提示。识别不了返回空串。 */
export function submissionHint(label?: string | null): string {
  const p = parseRound(label)
  if (!p) return ''
  return p.season === 'spring'
    ? `${String(p.year % 100).padStart(2, '0')}年8月提交`
    : `${String((p.year + 1) % 100).padStart(2, '0')}年3月提交`
}
