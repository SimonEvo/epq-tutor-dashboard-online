import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStudentStore } from '@/stores/studentStore'
import StudentCard from '@/components/StudentCard'
import AICommandCenter from '@/components/AICommandCenter'
import NagCenter from '@/components/NagCenter'
import KanbanProgressView from '@/components/views/KanbanProgressView'
import MilestoneGridView from '@/components/views/MilestoneGridView'
import OverviewView from '@/components/views/OverviewView'
import GanttView from '@/components/views/GanttView'
import WeekScheduleView from '@/components/views/WeekScheduleView'
import SubmissionSprintView from '@/components/views/SubmissionSprintView'
import type { Student, Supervisor, Trial } from '@/types'
import { formatHours, copyToClipboard, countsAsSaHour } from '@/lib/formatters'
import { listTrials, getDefaultRound } from '@/lib/dataService'

type ViewMode = 'schedule' | 'overview' | 'grid' | 'gantt' | 'kanban-progress' | 'milestone' | 'submission'

const VIEW_BUTTONS: { mode: ViewMode; label: string }[] = [
  { mode: 'schedule', label: '日程' },
  { mode: 'gantt', label: '甘特图' },
  { mode: 'submission', label: '提交' },
  { mode: 'overview', label: '概览' },
  { mode: 'grid', label: '卡片' },
  { mode: 'kanban-progress', label: '进度' },
  { mode: 'milestone', label: '里程碑' },
]

export default function DashboardPage() {
  const { students, tags, rounds, supervisors, isLoading, error, fetchAll, fetchTags, fetchRounds, fetchSupervisors } = useStudentStore()
  const [selectedTag, setSelectedTag] = useState<string>(
    () => localStorage.getItem('dashboard-tag') ?? ''
  )
  const [selectedRound, setSelectedRound] = useState<string>(
    () => localStorage.getItem('dashboard-round') ?? ''
  )
  const [saFilter, setSaFilter] = useState<'' | 'SA' | 'TA'>(
    () => (localStorage.getItem('dashboard-sa-filter') as '' | 'SA' | 'TA') ?? ''
  )
  const [sortBy, setSortBy] = useState<'name' | 'lastSession'>(
    () => (localStorage.getItem('dashboard-sort') as 'name' | 'lastSession') ?? 'lastSession'
  )
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem('dashboard-view-mode') as ViewMode) ?? 'overview'
  )

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    localStorage.setItem('dashboard-view-mode', mode)
  }

  const handleTag = (tag: string) => {
    setSelectedTag(tag)
    localStorage.setItem('dashboard-tag', tag)
  }

  const handleSaFilter = (value: '' | 'SA' | 'TA') => {
    setSaFilter(value)
    localStorage.setItem('dashboard-sa-filter', value)
  }

  const handleSortBy = (value: 'name' | 'lastSession') => {
    setSortBy(value)
    localStorage.setItem('dashboard-sort', value)
  }

  // Overtime modal
  const [showOvertime, setShowOvertime] = useState(false)
  const [overtimeTab, setOvertimeTab] = useState<'last' | 'current'>('last')
  const [overtimeTrials, setOvertimeTrials] = useState<Trial[]>([])
  const [overtimeCopied, setOvertimeCopied] = useState(false)

  // Stats modal
  const [showStats, setShowStats] = useState(false)
  const [statsCutoff, setStatsCutoff] = useState(new Date().toISOString().slice(0, 10))
  const [statsRound, setStatsRound] = useState<string>('')
  const [collapsedSA, setCollapsedSA] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchAll()
    fetchTags()
    fetchRounds()
    fetchSupervisors()
    // If no round remembered, fall back to backend default
    if (!localStorage.getItem('dashboard-round')) {
      getDefaultRound().then(r => { if (r) setSelectedRound(r) }).catch(() => {})
    }
  }, [fetchAll, fetchTags, fetchRounds, fetchSupervisors])

  const filtered = students
    .filter(s => !selectedTag || s.tags.includes(selectedTag))
    .filter(s => !selectedRound || s.submissionRound === selectedRound)
    .filter(s => {
      if (!saFilter) return true
      const supervisor = supervisors.find(sv => sv.id === s.supervisorId)
      const isZhongFang = supervisor?.saType === '中方SA'
      return saFilter === 'SA' ? isZhongFang : !isZhongFang
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      const lastA = getLastSession(a)
      const lastB = getLastSession(b)
      if (!lastA) return -1
      if (!lastB) return 1
      return lastA < lastB ? -1 : 1
    })

  if (isLoading) return <div className="p-8 text-gray-500 text-sm">Loading students…</div>
  if (error) return <div className="p-8 text-red-500 text-sm">Error: {error}</div>

  // Compute stats: only 英方SA students (determined by supervisor's saType, default 英方SA)
  const statsRows = students
    .filter(s => {
      const supervisor = supervisors.find(sv => sv.id === s.supervisorId)
      return !supervisor || supervisor.saType !== '中方SA'
    })
    .filter(s => !statsRound || s.submissionRound === statsRound)
    .map(s => {
      const supervisor = supervisors.find(sv => sv.id === s.supervisorId)
      const doneSessions = s.sessions.filter(
        sess => countsAsSaHour(sess) && sess.date <= statsCutoff
      )
      const sessionCount = doneSessions.length
      const totalMins = doneSessions.reduce((sum, sess) => sum + sess.durationMinutes, 0)
      const pastSaHours = totalMins / 60
      const saRemaining = s.saHoursTotal - pastSaHours
      return { s, supervisor, sessionCount, totalMins, pastSaHours, saRemaining }
    })
    .sort((a, b) => a.s.name.localeCompare(b.s.name))

  // Group stats by supervisor: how many sessions each SA taught + per-student breakdown
  type StatRow = typeof statsRows[number]
  const supervisorGroups = (() => {
    const map = new Map<string, { key: string; name: string; saType: string; students: StatRow[]; totalSessions: number; totalMins: number }>()
    for (const row of statsRows) {
      const key = row.supervisor?.id ?? '__none__'
      let g = map.get(key)
      if (!g) {
        g = { key, name: row.supervisor?.name ?? '未分配 SA', saType: row.supervisor?.saType ?? '英方SA', students: [], totalSessions: 0, totalMins: 0 }
        map.set(key, g)
      }
      g.students.push(row)
      g.totalSessions += row.sessionCount
      g.totalMins += row.totalMins
    }
    return [...map.values()].sort((a, b) => b.totalSessions - a.totalSessions || a.name.localeCompare(b.name))
  })()

  const toggleSA = (key: string) => setCollapsedSA(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })


  const copyStatsText = () => {
    const header = `课时统计（截止 ${statsCutoff}）\n${'─'.repeat(60)}`
    const blocks = supervisorGroups.map(g => {
      const title = `【${g.name}·${g.saType}】 共 ${g.totalSessions} 节课  总时长 ${formatHours(g.totalMins / 60)}`
      const lines = g.students.map(({ s, sessionCount, totalMins }) =>
        `  · ${s.name}${s.nameEn ? ` (${s.nameEn})` : ''}  ${sessionCount} 节  ${formatHours(totalMins / 60)}`
      ).join('\n')
      return title + '\n' + lines
    }).join('\n\n')
    copyToClipboard(header + '\n\n' + blocks)
  }

  return (
    <>
    {/* Overtime modal */}
    {showOvertime && (() => {
      const range = getWeekRange(overtimeTab === 'last' ? -1 : 0)
      const entries = buildOvertimeEntries(students, overtimeTrials, supervisors, range.from, range.to)
      const total = entries.reduce((s, e) => s + e.overtimeMins, 0)
      const copyText = buildOvertimeCopyText(entries, range.from, range.to)
      return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <h2 className="text-base font-semibold text-gray-900">加班申请</h2>
              <button onClick={() => setShowOvertime(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            {/* Tabs */}
            <div className="px-5 pt-3 flex gap-1 shrink-0">
              {([['last', '上周'], ['current', '本周']] as ['last'|'current', string][]).map(([tab, label]) => {
                const btnRange = getWeekRange(tab === 'last' ? -1 : 0)
                return (
                  <button
                    key={tab}
                    onClick={() => setOvertimeTab(tab)}
                    className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
                      overtimeTab === tab
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {label}（{fmtDateShort(btnRange.from)}–{fmtDateShort(btnRange.to)}）
                  </button>
                )
              })}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {entries.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">本周期内无加班记录</p>
              ) : (
                <div className="space-y-2">
                  {entries.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 text-xs w-12 shrink-0">{fmtDateShort(e.date)}</span>
                        <span className="text-gray-500 text-xs w-24 shrink-0">{e.timeStart}–{e.timeEnd}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-bg)] text-[var(--primary)] shrink-0">{e.label}</span>
                        <span className="text-gray-700">{e.personName}</span>
                      </div>
                      <span className="text-gray-500 text-xs shrink-0 ml-2">{e.overtimeMins}min</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-semibold text-gray-900 pt-2">
                    <span>加班总计</span>
                    <span>{fmtDuration(total)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 shrink-0">
              <button
                onClick={async () => {
                  await copyToClipboard(copyText)
                  setOvertimeCopied(true)
                  setTimeout(() => setOvertimeCopied(false), 2000)
                }}
                className="w-full text-sm py-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors"
              >
                {overtimeCopied ? '已复制 ✓' : '复制申请文本'}
              </button>
            </div>
          </div>
        </div>
      )
    })()}

    {/* Stats modal */}
    {showStats && (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <h2 className="text-base font-semibold text-gray-900">统计课时</h2>
            <button onClick={() => setShowStats(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>

          {/* Cutoff date + round filter */}
          <div className="px-5 py-3 border-b border-gray-100 flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 shrink-0">截止日期</label>
              <input
                type="date"
                value={statsCutoff}
                onChange={e => setStatsCutoff(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
              <span className="text-xs text-gray-400">英方SA · {supervisorGroups.length} 位SA · {statsRows.length} 人</span>
              <button
                onClick={copyStatsText}
                className="ml-auto text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
              >
                复制文本
              </button>
            </div>
            {rounds.length > 0 && (
              <div className="flex gap-2 flex-wrap items-center">
                <span className="text-xs text-gray-400 shrink-0">批次:</span>
                <button
                  onClick={() => setStatsRound('')}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    !statsRound ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  全部
                </button>
                {rounds.map(r => (
                  <button
                    key={r}
                    onClick={() => setStatsRound(r === statsRound ? '' : r)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      statsRound === r ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Grouped by supervisor */}
          <div className="overflow-y-auto flex-1">
            {supervisorGroups.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">暂无英方SA学生数据</p>
            ) : (
              <>
                {supervisorGroups.map(g => {
                  const collapsed = collapsedSA.has(g.key)
                  return (
                    <div key={g.key} className="border-b border-gray-100">
                      {/* Supervisor header — click to collapse */}
                      <button
                        onClick={() => toggleSA(g.key)}
                        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                      >
                        <span className="text-gray-400 text-xs w-3 shrink-0">{collapsed ? '▸' : '▾'}</span>
                        <span className="font-medium text-gray-900 text-sm">{g.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary-bg)] text-[var(--primary)]">{g.saType}</span>
                        <span className="text-xs text-gray-400">{g.students.length} 人</span>
                        <span className="ml-auto text-sm font-semibold text-gray-800">{g.totalSessions} 节 · {formatHours(g.totalMins / 60)}</span>
                      </button>

                      {/* Collapsible student list */}
                      {!collapsed && g.students.map(({ s, sessionCount, totalMins, pastSaHours, saRemaining }) => (
                        <div key={s.id} className="flex items-center gap-3 pl-10 pr-4 py-2 border-t border-gray-50 hover:bg-gray-50 text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-gray-900">{s.name}</span>
                            {s.nameEn && <span className="text-xs text-gray-400 ml-1.5">{s.nameEn}</span>}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">
                            已用 {formatHours(pastSaHours)}/{s.saHoursTotal}h
                            <span className={`ml-2 ${saRemaining <= 2 ? 'text-amber-600 font-medium' : ''}`}>剩 {formatHours(saRemaining)}</span>
                          </span>
                          <span className="w-14 text-right text-gray-700 font-medium shrink-0">{sessionCount} 节</span>
                          <span className="w-16 text-right text-gray-700 font-medium shrink-0">{formatHours(totalMins / 60)}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}

                {/* Overall total */}
                <div className="flex items-center px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm">
                  <span className="text-xs text-gray-400">合计</span>
                  <span className="ml-auto font-semibold text-gray-800">
                    {statsRows.reduce((s, r) => s + r.sessionCount, 0)} 节 · {formatHours(statsRows.reduce((s, r) => s + r.totalMins, 0) / 60)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )}


    <div className="p-6">
      <AICommandCenter />
      <NagCenter />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Students <span className="text-gray-400 font-normal text-lg">({filtered.length}{filtered.length !== students.length ? ` / ${students.length}` : ''})</span>
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowOvertime(true); listTrials().then(setOvertimeTrials).catch(() => {}) }}
            className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            加班申请
          </button>
          <button
            onClick={() => setShowStats(true)}
            className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            统计课时
          </button>
          <Link
            to="/students/new"
            className="bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
          >
            + Add Student
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        {/* Row 1: sort + round filter + view switcher */}
        <div className="flex gap-3 flex-wrap items-center">
          {viewMode !== 'kanban-progress' && viewMode !== 'milestone' && viewMode !== 'schedule' && (
            <select
              value={sortBy}
              onChange={e => handleSortBy(e.target.value as 'name' | 'lastSession')}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
            >
              <option value="lastSession">Sort: Needs attention first</option>
              <option value="name">Sort: Name A–Z</option>
            </select>
          )}

          {rounds.length > 0 && viewMode !== 'schedule' && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-gray-400">Round:</span>
              <button
                onClick={() => { setSelectedRound(''); localStorage.setItem('dashboard-round', '') }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  !selectedRound
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                All
              </button>
              {rounds.map(r => (
                <button
                  key={r}
                  onClick={() => { const v = r === selectedRound ? '' : r; setSelectedRound(v); localStorage.setItem('dashboard-round', v) }}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    selectedRound === r
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}

          {/* View mode switcher */}
          <div className="ml-auto flex rounded-lg border border-gray-200 overflow-hidden">
            {VIEW_BUTTONS.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => handleViewMode(mode)}
                className={`text-xs px-3 py-1.5 transition-colors border-r border-gray-200 last:border-r-0 ${
                  viewMode === mode
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: my role filter (SA / TA) */}
        {viewMode !== 'schedule' && (
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-gray-400">我的角色:</span>
          {([['', '全部'], ['SA', 'SA'], ['TA', 'TA']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => handleSaFilter(value)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                saFilter === value
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        )}

        {/* Row 3: tag filter */}
        {tags.length > 0 && viewMode !== 'schedule' && (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-xs text-gray-400">Tag:</span>
            <button
              onClick={() => handleTag('')}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                !selectedTag
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              All
            </button>
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => handleTag(tag === selectedTag ? '' : tag)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  selectedTag === tag
                    ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {viewMode === 'schedule' ? (
        <WeekScheduleView students={students} supervisors={supervisors} />
      ) : filtered.length === 0 ? (
        <div className="text-gray-400 text-sm py-16 text-center">
          {students.length === 0 ? 'No students yet. Add your first student!' : 'No students match this filter.'}
        </div>
      ) : viewMode === 'overview' ? (
        <OverviewView students={filtered} supervisors={supervisors} />
      ) : viewMode === 'gantt' ? (
        <GanttView students={filtered} allStudents={students} supervisors={supervisors} />
      ) : viewMode === 'kanban-progress' ? (
        <KanbanProgressView students={filtered} />
      ) : viewMode === 'milestone' ? (
        <MilestoneGridView students={filtered} />
      ) : viewMode === 'submission' ? (
        <SubmissionSprintView students={filtered} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(student => (
            <StudentCard key={student.id} student={student} />
          ))}
        </div>
      )}
    </div>
    </>
  )
}


// ── Overtime helpers ──────────────────────────────────────────────────────────

const WORK_START = 9 * 60
const LUNCH_START = 12 * 60 + 30
const LUNCH_END = 13 * 60 + 30
const WORK_END = 18 * 60
const WEEKDAY_OT_WINDOWS: [number, number][] = [
  [0, WORK_START],
  [LUNCH_START, LUNCH_END],
  [WORK_END, 24 * 60],
]

function parseTimeMins(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function addMins(hhmm: string, mins: number): string {
  const total = parseTimeMins(hhmm) + mins
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function computeOvertimeMins(date: string, time: string, durationMins: number): number {
  const dow = new Date(date + 'T12:00:00').getDay()
  if (dow === 0 || dow === 6) return durationMins
  const start = parseTimeMins(time)
  const end = start + durationMins
  let total = 0
  for (const [ws, we] of WEEKDAY_OT_WINDOWS) {
    const s = Math.max(start, ws)
    const e = Math.min(end, we)
    if (e > s) total += e - s
  }
  return total
}

function getWeekRange(weekOffset: 0 | -1): { from: string; to: string } {
  const today = new Date()
  const dow = today.getDay()
  const diffToMon = dow === 0 ? -6 : 1 - dow
  const mon = new Date(today)
  mon.setDate(today.getDate() + diffToMon + weekOffset * 7)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return { from: fmt(mon), to: fmt(sun) }
}

function fmtDateShort(iso: string): string {
  return iso.slice(5).replace('-', '.')
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? (m > 0 ? `${h}小时${m}分` : `${h}小时`) : `${m}分`
}

interface OvertimeEntry {
  date: string
  timeStart: string
  timeEnd: string
  overtimeMins: number
  label: string
  personName: string
}

const SESSION_LABEL: Record<string, string> = {
  SA_MEETING: 'SA',
  TA_MEETING: 'TA',
  THEORY: 'TE',
}

function buildOvertimeEntries(
  students: Student[],
  trials: Trial[],
  supervisors: Supervisor[],
  from: string,
  to: string,
): OvertimeEntry[] {
  const entries: OvertimeEntry[] = []

  for (const student of students) {
    const supervisor = supervisors.find(sv => sv.id === student.supervisorId)
    const isZhongFangSA = supervisor?.saType === '中方SA'

    for (const s of student.sessions) {
      if (!s.time || !s.durationMinutes) continue
      if (s.date < from || s.date > to) continue
      // SA_MEETING 只在导师本人真的被占用时算加班：中方SA 全程出席；
      // 英方SA 平时会议默认不占用导师，但最终答辩（isFinalDefense）双方都要到场，
      // 或勾了「导师出席」，同样要占用时间 —— 与 WeekScheduleView 的 occupies 判定保持一致
      if (s.type === 'SA_MEETING' && !isZhongFangSA && !s.isFinalDefense && !s.tutorAttending) continue
      const ot = computeOvertimeMins(s.date, s.time, s.durationMinutes)
      if (ot === 0) continue
      entries.push({
        date: s.date,
        timeStart: s.time,
        timeEnd: addMins(s.time, s.durationMinutes),
        overtimeMins: ot,
        label: s.isFinalDefense ? '答辩' : (SESSION_LABEL[s.type] ?? s.type),
        personName: student.name,
      })
    }
  }

  for (const t of trials) {
    if (!t.time || !t.durationMinutes) continue
    if (t.date < from || t.date > to) continue
    const ot = computeOvertimeMins(t.date, t.time, t.durationMinutes)
    if (ot === 0) continue
    entries.push({
      date: t.date,
      timeStart: t.time,
      timeEnd: addMins(t.time, t.durationMinutes),
      overtimeMins: ot,
      label: '试听课',
      personName: t.studentName,
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.timeStart.localeCompare(b.timeStart))
}

function buildOvertimeCopyText(entries: OvertimeEntry[], from: string, to: string): string {
  if (entries.length === 0) return `加班申请（${fmtDateShort(from)}–${fmtDateShort(to)}）\n\n本周无加班记录`
  const total = entries.reduce((s, e) => s + e.overtimeMins, 0)
  const lines = entries.map(e =>
    `${fmtDateShort(e.date)} ${e.timeStart}-${e.timeEnd} ${e.label} -- ${e.personName} ${e.overtimeMins}min`
  )
  lines.push(`\n加班总计：${fmtDuration(total)}`)
  return lines.join('\n')
}

function getLastSession(student: Student): string | undefined {
  if (!student.sessions.length) return undefined
  return [...student.sessions].sort((a, b) => b.date.localeCompare(a.date))[0].date
}
