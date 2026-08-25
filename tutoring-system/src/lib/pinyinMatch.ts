import { pinyin } from 'pinyin-pro'

/**
 * 学生下拉搜索的匹配打分。支持三种输入：
 *   汉字（张三）/ 拼音全拼（zhangsan）/ 拼音首字母（zs）/ 英文名（Raymond）
 * 姓氏按 mode:'surname' 处理，避免「单」「解」等姓被读错。
 */

export interface NameIndex {
  name: string       // 原始中文名（小写化后的原串，含非汉字）
  full: string       // 全拼，无空格 zhangsan
  initials: string   // 首字母 zs
  en: string         // 英文名小写
}

export function buildNameIndex(name: string, nameEn?: string): NameIndex {
  const syllables = name
    ? (pinyin(name, { toneType: 'none', type: 'array', mode: 'surname', nonZh: 'consecutive' }) as string[])
    : []
  return {
    name: (name || '').toLowerCase(),
    full: syllables.join('').toLowerCase(),
    initials: syllables.map(s => s[0] ?? '').join('').toLowerCase(),
    en: (nameEn || '').toLowerCase(),
  }
}

function norm(q: string) {
  return q.trim().toLowerCase().replace(/\s+/g, '')
}

/** 返回匹配分数，越大越靠前；-1 = 不匹配。前缀命中优于中间命中。 */
export function matchScore(idx: NameIndex, query: string): number {
  const q = norm(query)
  if (!q) return 0
  const fields: [string, number][] = [
    [idx.name, 100],
    [idx.en, 90],
    [idx.full, 80],
    [idx.initials, 70],
  ]
  let best = -1
  for (const [value, weight] of fields) {
    if (!value) continue
    if (value.startsWith(q)) best = Math.max(best, weight + 10)
    else if (value.includes(q)) best = Math.max(best, weight)
  }
  return best
}
