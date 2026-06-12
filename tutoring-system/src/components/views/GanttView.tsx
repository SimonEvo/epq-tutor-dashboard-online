import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Student, GanttProject, GanttTask, SessionRecord } from '@/types'
import { getGanttProject } from '@/lib/dataService'

const SESSION_COLOR: Record<string, string> = {
  SA_MEETING: '#FA8072',
  TA_MEETING: '#3b82f6',
}

interface Props {
  students: Student[]
}


function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

interface TooltipState { text: string; x: number; y: number }

export default function GanttView({ students }: Props) {
  const [project, setProject] = useState<GanttProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  function showTip(e: React.MouseEvent, text: string) {
    setTooltip({ text, x: e.clientX, y: e.clientY })
  }
  function moveTip(e: React.MouseEvent) {
    setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
  }
  function hideTip() { setTooltip(null) }

  useEffect(() => {
    getGanttProject('tutor', 'me')
      .then(p => setProject(p))
      .finally(() => setLoading(false))
  }, [])

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayISO = toISO(today)

  const windowStart = addDays(today, -2)
  const displayDays = 16  // today-2 ~ today+13
  const windowDates = Array.from({ length: displayDays }, (_, i) => addDays(windowStart, i))
  const windowStartISO = toISO(windowStart)
  const windowEndISO = toISO(windowDates[displayDays - 1])
  const colW = 100 / displayDays
  const LABEL_COL_W = 160  // w-40 = 10rem = 160px
  const minWidth = Math.max(640, displayDays * 28)
  const barAreaWidth = minWidth - LABEL_COL_W

  function stickyLabelStyle(bStyle: { left: string; width: string }) {
    const barLeftPx  = parseFloat(bStyle.left)  / 100 * barAreaWidth
    const barWidthPx = parseFloat(bStyle.width) / 100 * barAreaWidth
    const visibleLeftPx = Math.max(0, scrollLeft - LABEL_COL_W)
    const labelLeftPx   = Math.max(barLeftPx, visibleLeftPx)
    const labelWidthPx  = Math.max(0, barLeftPx + barWidthPx - labelLeftPx - 8)
    return {
      left:  `${labelLeftPx  / barAreaWidth * 100}%`,
      width: `${labelWidthPx / barAreaWidth * 100}%`,
    }
  }

  function barStyle(startISO: string, endISO: string) {
    const start = startISO < windowStartISO ? windowStartISO : startISO
    const end   = endISO   > windowEndISO ? windowEndISO : endISO
    if (start > end) return null
    const startOffset = Math.round((new Date(start).getTime() - windowStart.getTime()) / 86400000)
    const rawSpan     = Math.round((new Date(end).getTime()   - new Date(start).getTime()) / 86400000) + 1
    const span        = Math.min(rawSpan, displayDays - startOffset)
    return { left: `${startOffset * colW}%`, width: `${span * colW}%` }
  }

  function milestoneLeft(dateISO: string) {
    if (dateISO < windowStartISO || dateISO > windowEndISO) return null
    const offset = Math.round((new Date(dateISO).getTime() - windowStart.getTime()) / 86400000)
    return `${offset * colW + colW / 2}%`
  }

  // section name → tasks lookup
  const sections = project?.data?.sections ?? []
  const sectionIdByName = new Map(sections.map(s => [s.name, s.id]))
  const tasks = project?.data?.tasks ?? []

  function tasksForStudent(studentName: string): GanttTask[] {
    const secId = sectionIdByName.get(studentName)
    if (!secId) return []
    return tasks.filter(t => t.sectionId === secId)
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">加载中…</div>

  return (<>
    <div
      ref={scrollRef}
      className="overflow-x-auto"
      onScroll={() => setScrollLeft(scrollRef.current?.scrollLeft ?? 0)}
    >
      <div style={{ minWidth: `${minWidth}px` }}>

        {/* Header */}
        <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
          <div className="w-40 shrink-0 px-3 py-2 text-xs font-medium text-gray-500">学生</div>
          <div className="flex-1 flex">
            {windowDates.map(d => {
              const iso     = toISO(d)
              const isToday = iso === todayISO
              const isWknd  = d.getDay() === 0 || d.getDay() === 6
              const weekday = ['日','一','二','三','四','五','六'][d.getDay()]
              return (
                <div key={iso} className={`flex-1 text-center py-1.5 text-xs border-l ${
                  isToday ? 'bg-[var(--primary)] text-white font-bold border-[var(--primary)]'
                  : isWknd ? 'text-gray-400 border-gray-100' : 'text-gray-500 border-gray-100'
                }`}>
                  <div>{weekday}</div>
                  <div>{d.getDate()}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Rows */}
        {students.map(s => {
          const studentTasks = tasksForStudent(s.name)
          const visibleTasks = studentTasks.filter(t =>
            t.startDate && (t.endDate || t.milestone) &&
            (t.milestone
              ? t.startDate >= windowStartISO && t.startDate <= windowEndISO
              : t.startDate <= windowEndISO && t.endDate! >= windowStartISO)
          )

          return (
            <div
              key={s.id}
              className="flex border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
              style={{ minHeight: 48 }}
              onClick={() => navigate(`/students/${s.id}`)}
            >
              {/* Name */}
              <div className="w-40 shrink-0 px-3 py-2 flex flex-col justify-center">
                <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                {s.overview && <span className="text-xs text-gray-400 truncate">{s.overview}</span>}
              </div>

              {/* Bar area — all tasks overlap in one row */}
              <div className="flex-1 relative overflow-hidden" style={{ minHeight: 48 }}>
                {/* Grid */}
                <div className="absolute inset-0 flex pointer-events-none">
                  {windowDates.map(d => (
                    <div key={toISO(d)} className={`flex-1 border-l border-gray-100 ${
                      toISO(d) === todayISO ? 'bg-[var(--primary)]/10'
                      : (d.getDay() === 0 || d.getDay() === 6) ? 'bg-gray-50/60' : ''
                    }`} />
                  ))}
                </div>

                {/* SA / TA session markers */}
                {(s.sessions ?? [])
                  .filter((sess: SessionRecord) =>
                    (sess.type === 'SA_MEETING' || sess.type === 'TA_MEETING') &&
                    sess.date >= windowStartISO && sess.date <= windowEndISO
                  )
                  .map((sess: SessionRecord) => {
                    const offset = Math.round((new Date(sess.date).getTime() - windowStart.getTime()) / 86400000)
                    const left = `${offset * colW + colW / 2}%`
                    const color = SESSION_COLOR[sess.type]
                    const fullLabel = sess.type === 'SA_MEETING' ? 'SA会议' : 'TA会议'
                    return (
                      <div
                        key={sess.id}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 select-none cursor-pointer z-10"
                        style={{ left }}
                        onClick={e => { e.stopPropagation(); navigate(`/students/${s.id}/session/${sess.id}/edit`) }}
                      >
                        <div
                          className="rounded-md px-2 py-0.5 text-white whitespace-nowrap"
                          style={{ background: color, fontSize: 11, fontWeight: 600, opacity: 0.9 }}
                        >
                          {fullLabel}
                        </div>
                      </div>
                    )
                  })}

                {/* Task bars (overlapping) */}
                {visibleTasks.map(t => {
                  if (t.milestone) {
                    const left = milestoneLeft(t.startDate)
                    if (!left) return null
                    return (
                      <div
                        key={t.id}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[var(--primary)] select-none cursor-default"
                        style={{ left, fontSize: 22, lineHeight: 1 }}
                        onMouseEnter={e => showTip(e, `${t.name}：${t.startDate}`)}
                        onMouseMove={moveTip}
                        onMouseLeave={hideTip}
                      >
                        ◆
                      </div>
                    )
                  }

                  const style = barStyle(t.startDate, t.endDate!)
                  if (!style) return null
                  const color = t.color ?? 'var(--primary)'
                  const lblStyle = stickyLabelStyle(style)

                  return (
                    <div key={t.id} className="contents">
                      {/* Bar background — overflow-hidden for rounded clip */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-[22px] rounded overflow-hidden pointer-events-none"
                        style={{ left: style.left, width: style.width }}
                      >
                        <div className="absolute inset-0 opacity-80" style={{ background: color }} />
                      </div>
                      {/* Sticky label — positioned independently so it follows the viewport */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-[22px] flex items-center overflow-hidden pointer-events-none"
                        style={{ left: lblStyle.left, width: lblStyle.width, paddingLeft: 6 }}
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

    {tooltip && (
      <div
        className="fixed z-[9999] bg-gray-900 text-white text-xs rounded-md px-2.5 py-1.5 pointer-events-none shadow-lg whitespace-nowrap"
        style={{ left: tooltip.x + 14, top: tooltip.y - 36 }}
      >
        {tooltip.text}
      </div>
    )}
  </>
  )
}
