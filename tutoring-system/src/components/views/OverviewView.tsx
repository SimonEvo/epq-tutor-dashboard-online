import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Student, Supervisor } from '@/types'
import { isSessionStarted, formatHours } from '@/lib/formatters'
import AddSessionModal from '@/components/AddSessionModal'

interface Props {
  students: Student[]
  supervisors: Supervisor[]
}

function isChinaSA(student: Student, supervisors: Supervisor[]): boolean {
  const sv = supervisors.find(s => s.id === student.supervisorId)
  return sv?.saType === '中方SA'
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function formatShort(iso: string): string {
  const parts = iso.split('-')
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

function formatTouched(iso: string): string {
  const days = daysSince(iso)
  if (days === 0) return 'Today'
  const parts = iso.split('T')[0].split('-')
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

function urgencyColor(days: number | null): string {
  if (days === null) return '#9ca3af'
  if (days >= 15) return '#ef4444'
  if (days > 7) return '#f59e0b'
  return '#10b981'
}

const COL = {
  strip:    4,
  name:     120,
  nameEn:   120,
  overview: 160,
  lastMeet: 80,
  lastTouch:72,
  sa:       160,
  next:     100,
  avail:    200,
  note:     400,
}

function TH({ children, width }: { children: React.ReactNode; width: number }) {
  return (
    <div
      className="text-xs font-semibold tracking-widest uppercase text-gray-400 shrink-0 px-2"
      style={{ width }}
    >
      {children}
    </div>
  )
}

export default function OverviewView({ students, supervisors }: Props) {
  const navigate = useNavigate()
  const [addSessionStudent, setAddSessionStudent] = useState<Student | null>(null)

  return (
    <>
    {addSessionStudent && (
      <AddSessionModal
        student={addSessionStudent}
        onClose={() => setAddSessionStudent(null)}
        onSaved={() => setAddSessionStudent(null)}
      />
    )}
    <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
      {/* Header */}
      <div
        className="flex items-center bg-gray-50 border-b border-gray-200"
        style={{ minHeight: 36, paddingLeft: COL.strip }}
      >
        <TH width={COL.name}>姓名</TH>
        <TH width={COL.nameEn}>英文名</TH>
        <TH width={COL.overview}>简介</TH>
        <TH width={COL.lastMeet}>上次开会</TH>
        <TH width={COL.lastTouch}>上次更新</TH>
        <TH width={COL.sa}>SA 剩余</TH>
        <TH width={COL.next}>下次课</TH>
        <TH width={COL.avail}>可用时间</TH>
        <TH width={COL.note}>备注</TH>
      </div>

      {/* Rows */}
      {students.map((student, idx) => {
        const lastSa = [...student.sessions]
          .filter(s => s.type === 'SA_MEETING' && isSessionStarted(s))
          .sort((a, b) => b.date.localeCompare(a.date))[0]
        const lastTa = [...student.sessions]
          .filter(s => s.type === 'TA_MEETING' && isSessionStarted(s))
          .sort((a, b) => b.date.localeCompare(a.date))[0]

        const saDays = lastSa ? daysSince(lastSa.date) : null
        const taDays = lastTa ? daysSince(lastTa.date) : null
        const worstDays = saDays !== null && taDays !== null
          ? Math.max(saDays, taDays)
          : saDays ?? taDays
        const accent = urgencyColor(worstDays)
        const touchedLabel = student.updatedAt ? formatTouched(student.updatedAt) : '—'
        const touchedToday = student.updatedAt ? daysSince(student.updatedAt) === 0 : false

        const saUsed = student.sessions.filter(s => s.type === 'SA_MEETING' && isSessionStarted(s)).length
        const saRemaining = student.saHoursTotal - saUsed
        const saLow = saRemaining <= 2
        const saTotalMins = student.sessions.filter(s => s.type === 'SA_MEETING' && isSessionStarted(s)).reduce((s, x) => s + x.durationMinutes, 0)
        const saRemainingMins = student.saHoursTotal * 60 - saTotalMins
        const saColor = saLow ? '#ef4444' : '#10b981'

        const nextSa = [...student.sessions]
          .filter(s => s.type === 'SA_MEETING' && !isSessionStarted(s))
          .sort((a, b) => a.date.localeCompare(b.date))[0]
        const nextTa = [...student.sessions]
          .filter(s => s.type === 'TA_MEETING' && !isSessionStarted(s))
          .sort((a, b) => a.date.localeCompare(b.date))[0]

        const chinaSA = isChinaSA(student, supervisors)
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f9fafb'

        return (
          <div
            key={student.id}
            className="group relative flex items-center cursor-pointer transition-colors"
            style={{
              background: rowBg,
              borderBottom: idx < students.length - 1 ? '1px solid #f3f4f6' : 'none',
              minHeight: 56,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--primary-bg)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = rowBg }}
            onClick={() => navigate(`/students/${student.id}`)}
          >
            {/* Urgency strip */}
            <div className="self-stretch shrink-0" style={{ width: COL.strip, background: accent }} />

            {/* 姓名 */}
            <div
              className="px-2 py-3 shrink-0 font-semibold text-sm text-gray-900"
              style={{ width: COL.name, whiteSpace: 'nowrap' }}
            >
              {student.name}
            </div>

            {/* 英文名 */}
            <div className="px-2 shrink-0 overflow-hidden" style={{ width: COL.nameEn }}>
              <span className="text-xs text-gray-500 truncate block">{student.nameEn || '—'}</span>
            </div>

            {/* 简介 */}
            <div className="px-2 shrink-0 overflow-hidden" style={{ width: COL.overview }}>
              {student.overview
                ? <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-[var(--primary-bg)] text-[var(--primary)] whitespace-nowrap">{student.overview}</span>
                : <span className="text-xs text-gray-300">—</span>
              }
            </div>

            {/* 上次开会 */}
            <div className="px-2 shrink-0 flex flex-col gap-0.5" style={{ width: COL.lastMeet }}>
              <span className="text-xs tabular-nums font-medium" style={{ color: urgencyColor(saDays) }}>
                SA {lastSa ? formatShort(lastSa.date) : '—'}
              </span>
              {!chinaSA && (
                <span className="text-xs tabular-nums" style={{ color: urgencyColor(taDays) }}>
                  TA {lastTa ? formatShort(lastTa.date) : '—'}
                </span>
              )}
            </div>

            {/* 上次更新 */}
            <div className="px-2 shrink-0" style={{ width: COL.lastTouch }}>
              <span className={`text-xs tabular-nums ${touchedToday ? 'font-semibold text-green-600' : 'text-gray-400'}`}>
                {touchedLabel}
              </span>
            </div>

            {/* SA 剩余 — 两行：进度条 + 剩余小时 */}
            <div className="px-2 shrink-0 flex flex-col gap-1 py-2" style={{ width: COL.sa }}>
              <div className="flex gap-0.5">
                {Array.from({ length: Math.min(student.saHoursTotal, 20) }).map((_, i) => {
                  const used = i < saUsed
                  return (
                    <div
                      key={i}
                      className="h-1.5 flex-1 rounded-full"
                      style={{ background: used ? '#e5e7eb' : saLow ? '#fca5a5' : '#6ee7b7' }}
                    />
                  )
                })}
              </div>
              <span className="text-xs font-semibold tabular-nums" style={{ color: saColor }}>
                {formatHours(saRemainingMins / 60)}
              </span>
            </div>

            {/* 下次课 */}
            <div className="px-2 shrink-0 flex flex-col gap-0.5" style={{ width: COL.next }}>
              {nextSa
                ? <span className="text-xs font-medium text-gray-700">SA {formatShort(nextSa.date)}</span>
                : <span className="text-xs text-gray-300">SA —</span>
              }
              {!chinaSA && (
                nextTa
                  ? <span className="text-xs text-gray-500">TA {formatShort(nextTa.date)}</span>
                  : <span className="text-xs text-gray-300">TA —</span>
              )}
            </div>

            {/* 可用时间 */}
            <div className="px-2 shrink-0" style={{ width: COL.avail }}>
              {student.availabilityNote
                ? <span className="text-xs text-amber-700">{student.availabilityNote}</span>
                : <span className="text-xs text-gray-300">—</span>
              }
            </div>

            {/* 备注 */}
            <div className="px-2 shrink-0 overflow-hidden" style={{ width: COL.note }}>
              {student.briefNote
                ? <p className="text-xs text-gray-400 italic truncate">{student.briefNote}</p>
                : <span className="text-xs text-gray-300">—</span>
              }
            </div>

            {/* Hover: + Session */}
            <div
              className="absolute right-3 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={e => {
                e.stopPropagation()
                setAddSessionStudent(student)
              }}
            >
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white cursor-pointer">
                + Session
              </span>
            </div>
          </div>
        )
      })}
    </div>
    </>
  )
}
