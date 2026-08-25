import { useEffect, useMemo, useRef, useState } from 'react'
import type { Student } from '@/types'
import { buildNameIndex, matchScore } from '@/lib/pinyinMatch'

/**
 * 学生下拉搜索选择器。中文名（汉字 / 全拼 / 首字母）与英文名都能匹配。
 */

interface Props {
  students: Student[]
  value: string | null            // studentId
  onChange: (id: string | null) => void
  autoFocus?: boolean
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

export default function StudentPicker({ students, value, onChange, autoFocus }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const indexed = useMemo(
    () => students.map(s => ({ s, idx: buildNameIndex(s.name, s.nameEn) })),
    [students],
  )

  const results = useMemo(() => {
    return indexed
      .map(({ s, idx }) => ({ s, score: matchScore(idx, query) }))
      .filter(r => r.score >= 0)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .slice(0, 8)
      .map(r => r.s)
  }, [indexed, query])

  const selected = students.find(s => s.id === value) ?? null

  // 点外面收起
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (s: Student) => {
    onChange(s.id)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = results[cursor]; if (s) pick(s) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className="relative" ref={boxRef}>
      {selected && !open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setQuery('') }}
          className={`${inputCls} text-left flex items-center justify-between`}
        >
          <span className="text-gray-900">
            {selected.name}
            {selected.nameEn && <span className="text-gray-400 ml-1.5 text-xs">{selected.nameEn}</span>}
          </span>
          <span className="text-gray-300 text-xs">切换</span>
        </button>
      ) : (
        <input
          value={query}
          autoFocus={autoFocus || open}
          onChange={e => { setQuery(e.target.value); setCursor(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索学生：汉字 / 拼音 / 首字母 / 英文名"
          className={inputCls}
        />
      )}

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {results.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">无匹配学生</p>
          )}
          {results.map((s, i) => (
            <button
              key={s.id} type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(s)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                i === cursor ? 'bg-[var(--primary-bg)]' : 'hover:bg-gray-50'
              }`}
            >
              <span className="text-gray-900">{s.name}</span>
              {s.nameEn && <span className="text-xs text-gray-400">{s.nameEn}</span>}
              {s.id === value && <span className="ml-auto text-xs text-[var(--primary)]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
