import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Student, GanttProject, GanttTask, SessionRecord } from '@/types'
import { getGanttProject } from '@/lib/dataService'

const SESSION_COLOR: Record<string, string> = {
  SA_MEETING: '#FA8072',
  TA_MEETING: '#3b82f6',
}

const COL_W = 64

interface Props {
  students: Student[]
}

function pad(n: number) { return String(n).padStart(2, '0') }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86400000) }

interface TooltipState { text: string; x: number; y: number }

const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

export default function GanttView({ students }: Props) {
  const [project, setProject] = useState<GanttProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [initialScrollDone, setInitialScrollDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d }, [])
  const todayISO = toISO(today)

  // ── Date range from data ──────────────────────────────────────────────────
  const { startDate, endDate, totalDays, todayColIdx, dates, monthSpans } = useMemo(() => {
    let minD: Date | null = null
    let maxD: Date | null = null

    for (const s of students) {
      for (const sess of (s.sessions ?? [])) {
        const d = new Date(sess.date + 'T12:00:00')
        if (!minD || d < minD) minD = d
        if (!maxD || d > maxD) maxD = d
      }
    }

    if (project?.data?.tasks) {
      for (const t of project.data.tasks) {
        if (t.startDate) {
          const d = new Date(t.startDate + 'T12:00:00')
          if (!minD || d < minD) minD = d
          if (!maxD || d > maxD) maxD = d
        }
        if (t.endDate) {
          const d = new Date(t.endDate + 'T12:00:00')
          if (!minD || d < minD) minD = d
          if (!maxD || d > maxD) maxD = d
        }
      }
    }

    const rangeStart = minD ? addDays(minD, -7) : addDays(today, -30)
    const rangeEnd = maxD ? addDays(maxD, 14) : addDays(today, 60)

    const days = daysBetween(rangeStart, rangeEnd) + 1
    const todayIdx = daysBetween(rangeStart, today)
    const dateArr = Array.from({ length: days }, (_, i) => addDays(rangeStart, i))

    // Compute month spans for header
    const spans: { month: string; startIdx: number; count: number }[] = []
    for (let i = 0; i < dateArr.length; i++) {
      const mKey = `${dateArr[i].getFullYear()}-${dateArr[i].getMonth()}`
      if (spans.length === 0 || spans[spans.length - 1].month !== mKey) {
        spans.push({ month: mKey, startIdx: i, count: 1 })
      } else {
        spans[spans.length - 1].count++
      }
    }

    return { startDate: rangeStart, endDate: rangeEnd, totalDays: days, todayColIdx: todayIdx, dates: dateArr, monthSpans: spans }
  }, [students, project, today])

  const totalWidth = Math.max(640, totalDays * COL_W)

  // ── Scroll to today on first load ────────────────────────────────────────
  useEffect(() => {
    if (!scrollRef.current || totalDays === 0 || initialScrollDone) return
    const el = scrollRef.current
    const todayPx = todayColIdx * COL_W
    const target = Math.max(0, todayPx - el.clientWidth * 0.3)
    el.scrollTo({ left: target })
    setInitialScrollDone(true)
  }, [totalDays, todayColIdx, initialScrollDone])

  // ── Fetch GanttProject ───────────────────────────────────────────────────
  useEffect(() => {
    getGanttProject('tutor', 'me')
      .then(p => setProject(p))
      .finally(() => setLoading(false))
  }, [])

  // ── Section name → task lookup ───────────────────────────────────────────
  const sections = project?.data?.sections ?? []
  const sectionIdByName = new Map(sections.map(s => [s.name, s.id]))
  const tasks = project?.data?.tasks ?? []

  function tasksForStudent(studentName: string): GanttTask[] {
    const secId = sectionIdByName.get(studentName)
    if (!secId) return []
    return tasks.filter(t => t.sectionId === secId)
  }

  // ── Tooltip ──────────────────────────────────────────────────────────────
  function showTip(e: React.MouseEvent, text: string) { setTooltip({ text, x: e.clientX, y: e.clientY }) }
  function moveTip(e: React.MouseEvent) { setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null) }
  function hideTip() { setTooltip(null) }

  // ── Scroll handler ───────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    setScrollLeft(scrollRef.current.scrollLeft)
    setContainerWidth(scrollRef.current.clientWidth)
  }, [])

  const scrollToToday = () => {
    if (!scrollRef.current) return
    const todayPx = todayColIdx * COL_W
    scrollRef.current.scrollTo({ left: Math.max(0, todayPx - scrollRef.current.clientWidth * 0.3), behavior: 'smooth' })
  }

  // ── Today visibility ─────────────────────────────────────────────────────
  const todayLeft = todayColIdx * COL_W
  const todayRight = todayLeft + COL_W
  const todayVisible = todayRight > scrollLeft && todayLeft < scrollLeft + containerWidth

  // ── Sticky label logic (pixel-based) ─────────────────────────────────────
  function stickyLabelStyle(barLeftPx: number, barWidthPx: number) {
    const labelLeftPx = Math.max(barLeftPx, scrollLeft)
    const labelWidthPx = Math.max(0, barLeftPx + barWidthPx - labelLeftPx - 8)
    return { left: labelLeftPx, width: labelWidthPx }
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  function colIdxFromDate(iso: string): number {
    return daysBetween(startDate, new Date(iso + 'T12:00:00'))
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">加载中…</div>

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        onScroll={handleScroll}
      >
        <div style={{ minWidth: `${totalWidth}px` }}>
          {/* ── Month header ───────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-30">
            <div className="sticky left-0 w-40 shrink-0 px-3 py-1 text-xs font-medium text-gray-400 bg-gray-50 z-40 border-r border-gray-200" />
            <div className="flex">
              {monthSpans.map(s => (
                <div
                  key={s.month}
                  className="shrink-0 text-center py-1 text-xs font-medium text-gray-500 border-l border-gray-200"
                  style={{ width: s.count * COL_W }}
                >
                  {MONTHS[parseInt(s.month.split('-')[1])]}
                </div>
              ))}
            </div>
          </div>

          {/* ── Day header ─────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 bg-gray-50 sticky top-6 z-20">
            <div className="sticky left-0 w-40 shrink-0 px-3 py-2 text-xs font-medium text-gray-500 bg-gray-50 z-40 border-r border-gray-200">
              学生
            </div>
            <div className="flex">
              {dates.map(d => {
                const iso = toISO(d)
                const isToday = iso === todayISO
                const isWknd = d.getDay() === 0 || d.getDay() === 6
                const weekday = ['日','一','二','三','四','五','六'][d.getDay()]
                return (
                  <div
                    key={iso}
                    className={`shrink-0 text-center py-1.5 text-xs border-l ${
                      isToday ? 'bg-[var(--primary)] text-white font-bold border-[var(--primary)]'
                      : isWknd ? 'text-gray-400 border-gray-100' : 'text-gray-500 border-gray-100'
                    }`}
                    style={{ width: COL_W }}
                  >
                    <div>{weekday}</div>
                    <div>{d.getDate()}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Rows ──────────────────────────────────────────────────── */}
          {students.map(s => {
            const studentTasks = tasksForStudent(s.name)

            // Group same-day session markers so they stack instead of overlap
            const visibleSessions = (s.sessions ?? []).filter((sess: SessionRecord) =>
              (sess.type === 'SA_MEETING' || sess.type === 'TA_MEETING') &&
              sess.date >= toISO(startDate) && sess.date <= toISO(endDate)
            )
            const dayCount: Record<string, number> = {}
            for (const sess of visibleSessions) dayCount[sess.date] = (dayCount[sess.date] ?? 0) + 1
            const maxStack = Math.max(1, ...Object.values(dayCount))
            const STACK_H = 22
            const rowH = Math.max(48, maxStack * STACK_H + 14)
            const seen: Record<string, number> = {}

            return (
              <div
                key={s.id}
                className="flex border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                style={{ minHeight: rowH }}
                onClick={() => navigate(`/students/${s.id}`)}
              >
                {/* Sticky name column */}
                <div
                  className="sticky left-0 w-40 shrink-0 px-3 py-2 flex flex-col justify-center bg-white border-r border-gray-100 z-30"
                  style={{ minHeight: rowH }}
                >
                  <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                  {s.overview && <span className="text-xs text-gray-400 truncate">{s.overview}</span>}
                </div>

                {/* Bar area */}
                <div className="relative" style={{ width: totalDays * COL_W, minHeight: rowH }}>
                  {/* Grid background — weekends + today */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {dates.map(d => {
                      const iso = toISO(d)
                      const isWknd = d.getDay() === 0 || d.getDay() === 6
                      const isToday = iso === todayISO
                      return (
                        <div
                          key={iso}
                          className={`shrink-0 border-l border-gray-100 ${
                            isToday ? 'bg-[var(--primary)]/10'
                            : isWknd ? 'bg-gray-50/60' : ''
                          }`}
                          style={{ width: COL_W }}
                        />
                      )
                    })}
                  </div>

                  {/* SA / TA session markers — stack same-day vertically */}
                  {visibleSessions.map((sess: SessionRecord) => {
                      const idx = colIdxFromDate(sess.date)
                      const left = idx * COL_W + COL_W / 2
                      const color = SESSION_COLOR[sess.type]
                      const fullLabel = sess.type === 'SA_MEETING' ? 'SA会议' : 'TA会议'
                      const total = dayCount[sess.date] ?? 1
                      const order = seen[sess.date] = (seen[sess.date] ?? 0) + 1
                      // Center the stack vertically: offset each by STACK_H
                      const offset = (order - 1 - (total - 1) / 2) * STACK_H
                      return (
                        <div
                          key={sess.id}
                          className="absolute top-1/2 select-none cursor-pointer z-10"
                          style={{ left, transform: `translateY(${offset}px) translateY(-50%)` }}
                          onClick={e => { e.stopPropagation(); navigate(`/students/${s.id}/session/${sess.id}/edit`) }}
                        >
                          <div
                            className="rounded-md px-2 py-0.5 text-white whitespace-nowrap"
                            style={{ background: color, fontSize: 11, fontWeight: 600, opacity: 0.9, transform: 'translateX(-50%)' }}
                          >
                            {fullLabel}
                          </div>
                        </div>
                      )
                    })}

                  {/* GanttProject task bars */}
                  {studentTasks.map(t => {
                    if (t.milestone) {
                      const idx = colIdxFromDate(t.startDate)
                      if (idx < 0 || idx >= totalDays) return null
                      const left = idx * COL_W + COL_W / 2
                      return (
                        <div
                          key={t.id}
                          className="absolute top-1/2 -translate-y-1/2 text-[var(--primary)] select-none cursor-default"
                          style={{ left, fontSize: 22, lineHeight: 1, transform: 'translate(-50%, -50%)' }}
                          onMouseEnter={e => showTip(e, `${t.name}：${t.startDate}`)}
                          onMouseMove={moveTip}
                          onMouseLeave={hideTip}
                        >
                          ◆
                        </div>
                      )
                    }

                    if (!t.startDate || !t.endDate) return null

                    const startIdx = colIdxFromDate(t.startDate)
                    const endIdx = colIdxFromDate(t.endDate)
                    const clampedStart = Math.max(0, startIdx)
                    const clampedEnd = Math.min(totalDays - 1, endIdx)
                    if (clampedStart > clampedEnd || clampedEnd < 0 || clampedStart >= totalDays) return null

                    const barLeftPx = clampedStart * COL_W
                    const barWidthPx = (clampedEnd - clampedStart + 1) * COL_W
                    const color = t.color ?? 'var(--primary)'
                    const lblStyle = stickyLabelStyle(barLeftPx, barWidthPx)

                    return (
                      <div key={t.id} className="contents">
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-[22px] rounded overflow-hidden pointer-events-none"
                          style={{ left: barLeftPx, width: barWidthPx }}
                        >
                          <div className="absolute inset-0 opacity-80" style={{ background: color }} />
                        </div>
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-[22px] flex items-center overflow-hidden pointer-events-none"
                          style={{ left: lblStyle.left, width: Math.max(1, lblStyle.width), paddingLeft: 6 }}
                        >
                          <span className="text-white text-xs font-semibold truncate drop-shadow-sm" style={{ fontSize: 11 }}>
                            {t.name}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {students.length === 0 && (
            <div className="py-12 text-center text-gray-400 text-sm">没有学生</div>
          )}

          {!project && !loading && (
            <div className="px-4 py-2 text-xs text-gray-300 text-center border-t border-gray-100">
              在 gantt.simonevo.top 固定一个项目为 Dashboard 同步后此处自动更新
            </div>
          )}
        </div>
      </div>

      {/* ── Back to today ─────────────────────────────────────────────── */}
      {!todayVisible && totalDays > 0 && (
        <button
          onClick={scrollToToday}
          className="absolute top-14 right-4 z-30 text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-600 shadow-md hover:bg-gray-50 transition-all"
        >
          回到今天
        </button>
      )}

      {/* ── Tooltip ───────────────────────────────────────────────────── */}
      {tooltip && (
        <div
          className="fixed z-[9999] bg-gray-900 text-white text-xs rounded-md px-2.5 py-1.5 pointer-events-none shadow-lg whitespace-nowrap"
          style={{ left: tooltip.x + 14, top: tooltip.y - 36 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}
