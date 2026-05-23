import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Student } from '@/types'
import { useStudentStore } from '@/stores/studentStore'

interface Props {
  student: Student
}

export default function StudentCard({ student }: Props) {
  const patchHomeworkItem = useStudentStore(s => s.patchHomeworkItem)
  const entry = student.latestHomeworkEntry
  const items = entry?.items ?? []
  const [saving, setSaving] = useState<number | null>(null)

  const doneCount = items.filter(i => i.done).length
  const allDone = items.length > 0 && doneCount === items.length
  const accentColor = items.length === 0
    ? '#d1d5db'
    : allDone ? '#10b981' : '#f59e0b'

  const toggle = async (idx: number, e: React.MouseEvent) => {
    e.preventDefault()
    if (!entry || saving !== null) return
    setSaving(idx)
    try {
      await patchHomeworkItem(student.id, entry.id, idx, !items[idx].done)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg"
      style={{
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.06)',
        borderLeft: `4px solid ${accentColor}`,
      }}
    >
      {/* Header — clicks navigate to detail */}
      <Link
        to={`/students/${student.id}`}
        className="block px-4 pt-4 pb-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 leading-tight">
              {student.name}
            </h2>
            {student.nameEn && (
              <p className="text-xs text-gray-400 mt-0.5 tracking-wide">{student.nameEn}</p>
            )}
          </div>
          {items.length > 0 && (
            <span className="text-xs tabular-nums text-gray-400 shrink-0 mt-0.5">
              {doneCount}/{items.length}
            </span>
          )}
        </div>
        {student.overview && (
          <span className="inline-block mt-1.5 text-xs font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">
            {student.overview}
          </span>
        )}
      </Link>

      {/* Homework body — clicks toggle checkboxes */}
      <div className="px-4 py-3">
        {entry ? (
          <>
            <p className="text-xs text-gray-400 mb-2">{entry.sourceLabel}</p>
            <ul className="space-y-1.5">
              {items.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 cursor-pointer select-none hover:bg-gray-50 -mx-2 px-2 py-0.5 rounded"
                  onClick={e => toggle(idx, e)}
                >
                  <div
                    className="mt-0.5 shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors"
                    style={{
                      background: item.done ? accentColor : 'transparent',
                      borderColor: item.done ? accentColor : '#d1d5db',
                      opacity: saving === idx ? 0.5 : 1,
                    }}
                  >
                    {item.done && (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span
                    className="text-xs leading-snug"
                    style={{ color: item.done ? '#9ca3af' : '#374151', textDecoration: item.done ? 'line-through' : 'none' }}
                  >
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-gray-300">暂无作业</p>
        )}
      </div>
    </div>
  )
}
