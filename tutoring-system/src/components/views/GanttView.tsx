import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Student, Supervisor, GanttProject, GanttTask, SessionRecord } from '@/types'
import { getGanttProject, peekGanttProject } from '@/lib/dataService'
import { getWrappedOpen, setWrappedOpen } from '@/lib/submission'
import AddSessionModal from '@/components/AddSessionModal'
import QuickSessionEditPopover from '@/components/QuickSessionEditPopover'
import { printGantt } from '@/lib/ganttPrint'
import ScheduleLegend, { type LegendItem } from '@/components/views/ScheduleLegend'
import {
  SESSION_COLOR, SESSION_LABEL, FEEDBACK_DONE_RING, FEEDBACK_DUE_RING,
  SA_ZHONGFANG_COLOR, SA_ZHONGFANG_DEFENSE_COLOR, SA_YINGFANG_DEFENSE_COLOR,
  FIXED_SECTION, FIXED_DEFAULT_COLOR,
} from '@/lib/ganttColors'

const COL_W = 64

// 图例：只列甘特图真会画出来的东西。英方SA 这里不弱化成灰——课后反馈状态环
// 要贴在这个底色上，弱化了看不清（和日历视图的处理刻意不同）。
const GANTT_LEGEND_ITEMS: LegendItem[] = [
  { label: '中方SA', color: SA_ZHONGFANG_COLOR, title: '导师本人当 SA' },
  { label: '英方SA', color: SESSION_COLOR.SA_MEETING, title: '英方SA 会议' },
  { label: '最终答辩', color: SA_ZHONGFANG_DEFENSE_COLOR, color2: SA_YINGFANG_DEFENSE_COLOR, title: '左上=中方 / 右下=英方，两边都要出席' },
  { label: 'TA', color: SESSION_COLOR.TA_MEETING },
  { label: '理论', color: SESSION_COLOR.THEORY },
  { label: '固定安排', color: FIXED_DEFAULT_COLOR, title: '出差 / deadline 等整页高亮' },
]

interface Props {
  students: Student[]      // 当前 round 过滤后的学生，只决定显示哪些行
  allStudents: Student[]   // 全部学生，仅用于计算稳定的时间轴范围（切 round 时轴不变）
  supervisors: Supervisor[]
  roundLabel: string       // 当前届过滤，导出 PDF 的标题里要写
}

function pad(n: number) { return String(n).padStart(2, '0') }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86400000) }
// 工作日（周一~周五）计数，[fromISO, toISO] 闭区间；to 早于 from 返回 0
function workingDaysInclusive(fromISO: string, toISO: string): number {
  const from = new Date(fromISO + 'T12:00:00')
  const to = new Date(toISO + 'T12:00:00')
  if (to < from) return 0
  let count = 0
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) count++
  }
  return count
}

interface TooltipState { text: string; x: number; y: number }

const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']

export default function GanttView({ students, allStudents, supervisors, roundLabel }: Props) {
  const supervisorById = useMemo(
    () => new Map(supervisors.map(sv => [sv.id, sv])),
    [supervisors]
  )
  // 命中内存缓存就直接渲染，后台再刷新——避免每次切回甘特视图都卡「加载中…」
  const [project, setProject] = useState<GanttProject | null>(() => peekGanttProject('tutor', 'me') ?? null)
  const [loading, setLoading] = useState(() => peekGanttProject('tutor', 'me') === undefined)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [initialScrollDone, setInitialScrollDone] = useState(false)
  const [addSessionStudent, setAddSessionStudent] = useState<Student | null>(null)
  const [editSession, setEditSession] = useState<{ studentId: string; studentName: string; sessionId: string } | null>(null)
  // 已结项分组的展开状态跨视图联动（与提交视图 / 甘特图共用）
  const [showWrapped, setShowWrapped] = useState(getWrappedOpen)
  const [printHint, setPrintHint] = useState('')
  const toggleWrapped = () => {
    setShowWrapped(v => {
      setWrappedOpen(!v)
      return !v
    })
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevStartRef = useRef<Date | null>(null)
  const navigate = useNavigate()

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d }, [])
  const todayISO = toISO(today)

  // ── Date range from data ──────────────────────────────────────────────────
  const { startDate, endDate, totalDays, todayColIdx, dates, monthSpans, startWeekday } = useMemo(() => {
    let minD: Date | null = null
    let maxD: Date | null = null

    // 用全部学生算范围，切 round 时时间轴/滚动位置保持不变（仅过滤显示行）
    for (const s of allStudents) {
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

    return { startDate: rangeStart, endDate: rangeEnd, totalDays: days, todayColIdx: todayIdx, dates: dateArr, monthSpans: spans, startWeekday: rangeStart.getDay() }
  }, [allStudents, project, today])

  const totalWidth = Math.max(640, totalDays * COL_W)

  // 行背景：1px 竖线 + 周末底色，全部用 background 图案画（周期 = 7 * COL_W）。
  // 图案按周日起画，再用 background-position 平移到时间轴起始那天的星期。
  const gridBgStyle = useMemo(() => {
    const week = 7 * COL_W
    const wknd = 'rgba(249,250,251,0.6)'   // = bg-gray-50/60
    const line = '#f3f4f6'                 // = border-gray-100
    return {
      backgroundImage: [
        `repeating-linear-gradient(to right, ${line} 0 1px, transparent 1px ${COL_W}px)`,
        `linear-gradient(to right, ${wknd} 0 ${COL_W}px, transparent ${COL_W}px ${6 * COL_W}px, ${wknd} ${6 * COL_W}px ${week}px)`,
      ].join(', '),
      backgroundSize: `${COL_W}px 100%, ${week}px 100%`,
      backgroundPosition: `0 0, ${-startWeekday * COL_W}px 0`,
      backgroundRepeat: 'repeat',
    } as React.CSSProperties
  }, [startWeekday])

  // ── Scroll to today on first load only ───────────────────────────────────
  // The timeline range is derived from allStudents, so switching round no longer
  // moves day-0 — the scroll position is preserved naturally on a round switch.
  useEffect(() => {
    if (!scrollRef.current || totalDays === 0 || initialScrollDone) return
    const el = scrollRef.current
    const target = Math.max(0, todayColIdx * COL_W - el.clientWidth * 0.3)
    el.scrollTo({ left: target })
    setInitialScrollDone(true)
    prevStartRef.current = startDate
  }, [totalDays, todayColIdx, initialScrollDone, startDate])

  // ── Keep the calendar date under the viewport fixed if day-0 still shifts ──
  // (e.g. the GanttProject loads asynchronously after the first paint). Round
  // switches don't reach here since startDate is now stable across them.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const prev = prevStartRef.current
    if (!el || !prev || !initialScrollDone) { prevStartRef.current = startDate; return }
    const dayShift = daysBetween(startDate, prev) // >0 when the range now starts earlier
    if (dayShift !== 0) el.scrollLeft += dayShift * COL_W
    prevStartRef.current = startDate
  }, [startDate, initialScrollDone])

  // ── Fetch GanttProject ───────────────────────────────────────────────────
  useEffect(() => {
    getGanttProject('tutor', 'me')
      .then(p => setProject(p))
      .finally(() => setLoading(false))
  }, [])

  // ── Section name → task lookup ───────────────────────────────────────────
  const activeStudents = students.filter(s => !s.wrappedUpAt)
  const wrappedStudents = students.filter(s => !!s.wrappedUpAt)

  const sectionIdByName = useMemo(
    () => new Map((project?.data?.sections ?? []).map(s => [s.name, s.id])),
    [project]
  )

  // sectionId -> tasks，避免每个学生行都 filter 一遍全量 tasks
  const tasksBySection = useMemo(() => {
    const m = new Map<string, GanttTask[]>()
    for (const t of project?.data?.tasks ?? []) {
      if (!t.sectionId) continue
      const arr = m.get(t.sectionId)
      if (arr) arr.push(t)
      else m.set(t.sectionId, [t])
    }
    return m
  }, [project])

  // 结项学生抽出到底部分组渲染（收起不是隐藏，否则找不到人取消结项）
  const renderStudentRow = (s: Student) => {
            const studentTasks = tasksForStudent(s.name)

            // Group same-day session markers so they stack instead of overlap
            const visibleSessions = (s.sessions ?? []).filter((sess: SessionRecord) =>
              (sess.type === 'SA_MEETING' || sess.type === 'TA_MEETING' || sess.type === 'THEORY') &&
              sess.date >= toISO(startDate) && sess.date <= toISO(endDate)
            )
            const isZhongFangSA = s.supervisorId
              ? supervisorById.get(s.supervisorId)?.saType === '中方SA'
              : false
            const dayCount: Record<string, number> = {}
            for (const sess of visibleSessions) dayCount[sess.date] = (dayCount[sess.date] ?? 0) + 1
            const maxStack = Math.max(1, ...Object.values(dayCount))
            const STACK_H = 22
            const rowH = Math.max(48, maxStack * STACK_H + 14)
            const seen: Record<string, number> = {}

            return (
              <div
                key={s.id}
                className="group flex border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                style={{ minHeight: rowH }}
                onClick={() => navigate(`/students/${s.id}`)}
              >
                {/* Sticky name column */}
                <div
                  className="sticky left-0 w-40 shrink-0 px-3 py-2 flex flex-col justify-center bg-white group-hover:bg-gray-50 border-r border-gray-100 z-30"
                  style={{ minHeight: rowH }}
                >
                  <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                  {s.overview && <span className="text-xs text-gray-400 truncate">{s.overview}</span>}

                  {/* Hover: + Session */}
                  <div
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); setAddSessionStudent(s) }}
                  >
                    <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-[var(--accent)] text-white cursor-pointer whitespace-nowrap">
                      + Session
                    </span>
                  </div>
                </div>

                {/* Bar area */}
                <div className="relative" style={{ width: totalDays * COL_W, minHeight: rowH }}>
                  {/* Grid background — 周末底色 + 竖线用 CSS 渐变画，
                      原来每行每天一个 div（天数 x 学生数，几千个节点）是切视图卡顿主因 */}
                  <div className="absolute inset-0 pointer-events-none" style={gridBgStyle} />
                  {/* 今天：整列高亮，一行只要一个 div */}
                  {todayColIdx >= 0 && todayColIdx < totalDays && (
                    <div
                      className="absolute inset-y-0 pointer-events-none bg-[var(--primary)]/10"
                      style={{ left: todayColIdx * COL_W, width: COL_W }}
                    />
                  )}

                  {/* 固定安排 highlight bands (出差 / deadlines) */}
                  {fixedTasks.map(t => fixedBand(t, `${s.id}-${t.id}`))}

                  {/* SA / TA session markers — stack same-day vertically */}
                  {visibleSessions.map((sess: SessionRecord) => {
                      const idx = colIdxFromDate(sess.date)
                      const left = idx * COL_W + COL_W / 2
                      const isSA = sess.type === 'SA_MEETING'
                      const isDefense = isSA && sess.isFinalDefense
                      const color = isSA
                        ? (isDefense
                            ? (isZhongFangSA ? SA_ZHONGFANG_DEFENSE_COLOR : SA_YINGFANG_DEFENSE_COLOR)
                            : (isZhongFangSA ? SA_ZHONGFANG_COLOR : SESSION_COLOR.SA_MEETING))
                        : SESSION_COLOR[sess.type]
                      const fullLabel = isDefense ? '最终答辩' : SESSION_LABEL[sess.type]
                      // SA 课后反馈状态环：已发送=绿；未发送且已到第 3 个工作日（含逾期）=黄
                      let feedbackRing: string | undefined
                      let feedbackTip: string | undefined
                      if (isSA) {
                        if (sess.feedbackSent) {
                          feedbackRing = FEEDBACK_DONE_RING
                          feedbackTip = '课后反馈已发送'
                        } else if (sess.date <= todayISO && workingDaysInclusive(sess.date, todayISO) >= 3) {
                          feedbackRing = FEEDBACK_DUE_RING
                          feedbackTip = '课后反馈今天必须提供'
                        }
                      }
                      const total = dayCount[sess.date] ?? 1
                      const order = seen[sess.date] = (seen[sess.date] ?? 0) + 1
                      // Center the stack vertically: offset each by STACK_H
                      const offset = (order - 1 - (total - 1) / 2) * STACK_H
                      return (
                        <div
                          key={sess.id}
                          className="absolute top-1/2 select-none cursor-pointer z-10"
                          style={{ left, transform: `translateY(${offset}px) translateY(-50%)` }}
                          onClick={e => { e.stopPropagation(); setEditSession({ studentId: s.id, studentName: s.name, sessionId: sess.id }) }}
                        >
                          {/* padded wrapper so the ring's white-gap halo is also clickable */}
                          <div style={{ transform: 'translateX(-50%)', padding: 3 }}>
                            <div
                              className="rounded-md px-2 py-0.5 text-white whitespace-nowrap"
                              style={{
                                background: color, fontSize: 11, fontWeight: 600,
                                opacity: feedbackRing ? 1 : 0.9,
                                // 环与底色间加一圈白色间隔，避免黄环贴在橙色 SA 上对比过低
                                ...(feedbackRing ? { boxShadow: `0 0 0 1.5px #fff, 0 0 0 3px ${feedbackRing}` } : {}),
                              }}
                              title={feedbackTip ?? (isDefense ? '最终答辩' : undefined)}
                            >
                              {fullLabel}
                            </div>
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
  }

  function tasksForStudent(studentName: string): GanttTask[] {
    const secId = sectionIdByName.get(studentName)
    if (!secId) return []
    return tasksBySection.get(secId) ?? []
  }

  // ── 固定安排 section: whole-page highlight (出差 / deadlines 等) ──────────────
  const fixedSectionId = sectionIdByName.get(FIXED_SECTION)
  const fixedTasks = (fixedSectionId ? tasksBySection.get(fixedSectionId) : undefined) ?? []

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

  // Subtle background band for a 固定安排 task (repeated per row → continuous vertical highlight)
  function fixedBand(t: GanttTask, key: string) {
    const color = t.color ?? FIXED_DEFAULT_COLOR
    if (t.milestone || !t.endDate) {
      const idx = colIdxFromDate(t.startDate)
      if (idx < 0 || idx >= totalDays) return null
      return (
        <div
          key={key}
          className="absolute inset-y-0 pointer-events-none"
          style={{ left: idx * COL_W + COL_W / 2 - 1, width: 2, background: color, opacity: 0.45 }}
        />
      )
    }
    const cs = Math.max(0, colIdxFromDate(t.startDate))
    const ce = Math.min(totalDays - 1, colIdxFromDate(t.endDate))
    if (cs > ce) return null
    return (
      <div
        key={key}
        className="absolute inset-y-0 pointer-events-none"
        style={{ left: cs * COL_W, width: (ce - cs + 1) * COL_W, background: color, opacity: 0.1 }}
      />
    )
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">加载中…</div>

  return (
    <div className="relative">
      {addSessionStudent && (
        <AddSessionModal
          student={addSessionStudent}
          onClose={() => setAddSessionStudent(null)}
          onSaved={() => setAddSessionStudent(null)}
        />
      )}
      {editSession && (
        <QuickSessionEditPopover
          studentId={editSession.studentId}
          studentName={editSession.studentName}
          sessionId={editSession.sessionId}
          onClose={() => setEditSession(null)}
          onSaved={() => setEditSession(null)}
        />
      )}
      <div className="mb-3 flex items-start gap-3">
        <ScheduleLegend items={GANTT_LEGEND_ITEMS} />
        <button
          onClick={() => setPrintHint(printGantt({ students, supervisors, project, roundLabel }) ?? '')}
          title="把已上的课排成一张超宽的打印页，在打印对话框里选「另存为 PDF」"
          className="ml-auto shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-gray-300 transition-colors"
        >
          导出 PDF
        </button>
      </div>
      {printHint && (
        <p className="mb-3 text-xs text-amber-600">{printHint}</p>
      )}
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

          {/* ── 固定安排 legend row ────────────────────────────────────── */}
          {fixedTasks.length > 0 && (
            <div className="flex border-b border-gray-200 bg-white" style={{ minHeight: 30 }}>
              <div className="sticky left-0 w-40 shrink-0 px-3 flex items-center bg-gray-50 border-r border-gray-200 z-30 text-xs font-medium text-gray-500">
                固定安排
              </div>
              <div className="relative" style={{ width: totalDays * COL_W, minHeight: 30 }}>
                {fixedTasks.map(t => {
                  const color = t.color ?? FIXED_DEFAULT_COLOR
                  if (t.milestone || !t.endDate) {
                    const idx = colIdxFromDate(t.startDate)
                    if (idx < 0 || idx >= totalDays) return null
                    return (
                      <div
                        key={t.id}
                        className="absolute top-1/2 flex items-center gap-1 whitespace-nowrap"
                        style={{ left: idx * COL_W + COL_W / 2, transform: 'translate(-50%,-50%)' }}
                        onMouseEnter={e => showTip(e, `${t.name}：${t.startDate}`)}
                        onMouseMove={moveTip}
                        onMouseLeave={hideTip}
                      >
                        <span style={{ color, fontSize: 12 }}>◆</span>
                        <span className="text-xs font-medium" style={{ color }}>{t.name}</span>
                      </div>
                    )
                  }
                  const cs = Math.max(0, colIdxFromDate(t.startDate))
                  const ce = Math.min(totalDays - 1, colIdxFromDate(t.endDate))
                  if (cs > ce) return null
                  return (
                    <div
                      key={t.id}
                      className="absolute top-1/2 -translate-y-1/2 rounded px-2 flex items-center overflow-hidden"
                      style={{ left: cs * COL_W, width: (ce - cs + 1) * COL_W, height: 20, background: color, opacity: 0.9 }}
                      onMouseEnter={e => showTip(e, `${t.name}：${t.startDate} → ${t.endDate}`)}
                      onMouseMove={moveTip}
                      onMouseLeave={hideTip}
                    >
                      <span className="text-white truncate font-medium" style={{ fontSize: 11 }}>{t.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Rows ──────────────────────────────────────────────────── */}
          {activeStudents.map(renderStudentRow)}

          {wrappedStudents.length > 0 && (
            <>
              <div
                className="flex border-b border-gray-100 bg-gray-50 cursor-pointer select-none"
                onClick={toggleWrapped}
              >
                {/* 标签自己 sticky —— 整条 sticky 的话横向滚走就看不见了 */}
                <div className="sticky left-0 z-30 flex items-center gap-2 px-3 py-2 bg-gray-50">
                  <span className="text-xs text-gray-500">{showWrapped ? '▾' : '▸'}</span>
                  <span className="text-xs text-gray-500">已结项 ({wrappedStudents.length})</span>
                </div>
              </div>
              {showWrapped && wrappedStudents.map(renderStudentRow)}
            </>
          )}

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
