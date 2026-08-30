import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Student, Supervisor, SessionRecord, Trial, ScheduleEvent } from '@/types'
import { listTrials, listScheduleEvents } from '@/lib/dataService'
import QuickSessionEditPopover from '@/components/QuickSessionEditPopover'
import QuickEventEditPopover from '@/components/QuickEventEditPopover'
import ScheduleCreateDialog from '@/components/ScheduleCreateDialog'

interface Props {
  students: Student[]
  supervisors: Supervisor[]
}

// 类型配色 —— 与甘特图/报告全系统一致
const SESSION_COLOR: Record<string, string> = {
  SA_MEETING: '#D1D5DB',
  TA_MEETING: '#3b82f6',
  THEORY: '#22c55e',
}
// 中方SA 平时会议用温和 prince 紫；英方SA 平时无需出席，弱化为浅灰
const SA_ZHONGFANG_COLOR = '#9575CD'
const SA_DIMMED_TEXT = '#6B7280'
// 若勾选「导师出席」，英方SA 平时会议恢复正常 salmon
const SA_YINGFANG_ATTENDING_COLOR = '#FA8072'
// 最终答辩：无论中英方都要出席，配色单独拉出来强调
const SA_ZHONGFANG_DEFENSE_COLOR = '#A21CAF'  // 紫红
const SA_YINGFANG_DEFENSE_COLOR = '#db4d4d'   // 醒目红
const TRIAL_COLOR = '#f59e0b'   // 琥珀
const EVENT_COLOR = '#eb66a8'   // 暖粉 —— 自定义事件（如私人安排）
const OT_EVENT_COLOR = '#0d9488'  // 青 —— 「加个班儿」：非学生会议的加班项目，进加班申请
// 占用模式：所有安排一律统一灰块，不区分类型、不露姓名
const BUSY_COLOR = '#9CA3AF'
const BUSY_LABEL = '占用'

const SESSION_LABEL: Record<string, string> = { SA_MEETING: 'SA', TA_MEETING: 'TA', THEORY: '理论' }

// 工作时间窗（与 DashboardPage 加班规则 WEEKDAY_OT_WINDOWS 对齐）：周一~周五
const WORK_BANDS: [number, number][] = [[9 * 60, 12 * 60 + 30], [13 * 60 + 30, 18 * 60]]
const WORK_BG = 'rgba(100,116,139,0.09)'  // 淡中性灰蓝，不用绿（绿留给理论课）
// 网格线：整点稍实、半点更淡的虚线，读得出时间格又不抢块
const HOUR_LINE = 'rgba(100,116,139,0.22)'
const HALF_HOUR_LINE = 'rgba(100,116,139,0.14)'

const HOUR_H = 48          // 每小时像素
const DEFAULT_START = 8 * 60
const DEFAULT_END = 21 * 60
const MIN_BLOCK_H = 18

function pad(n: number) { return String(n).padStart(2, '0') }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function parseMin(hhmm?: string): number | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}
function fmtMin(mins: number): string { return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` }
// 「09:00–10:00」；未定时的块没有起点，退回原始 time 字段
function fmtRange(b: Block): string {
  if (b.startMin === null) return b.time ?? ''
  return `${fmtMin(b.startMin)}–${fmtMin(b.startMin + b.durationMin)}`
}

interface Block {
  key: string
  kind: 'session' | 'trial' | 'event'
  date: string
  startMin: number | null   // null = 未定时
  durationMin: number
  label: string
  time?: string
  color: string
  textColor?: string
  occupies: boolean          // 导师本人是否真的被占用（英方SA 未勾出席 = 不占用）
  studentId?: string
  studentName?: string
  sessionId?: string
  trialId?: string
  event?: ScheduleEvent
}

const WEEKDAY = ['一', '二', '三', '四', '五', '六', '日']

export default function WeekScheduleView({ students, supervisors }: Props) {
  const navigate = useNavigate()
  const supervisorById = useMemo(() => new Map(supervisors.map(sv => [sv.id, sv])), [supervisors])

  const [weekOffset, setWeekOffset] = useState(0)
  // 占用模式：截图发学生看空闲时段用 —— 所有块统一为灰色「占用」，不露姓名/类型
  const [busyMode, setBusyMode] = useState(false)
  const [trials, setTrials] = useState<Trial[]>([])
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [now, setNow] = useState(new Date())

  const [editSession, setEditSession] = useState<{ studentId: string; studentName: string; sessionId: string } | null>(null)
  const [editEvent, setEditEvent] = useState<ScheduleEvent | null>(null)
  const [createPrefill, setCreatePrefill] = useState<{ date: string; time: string } | null>(null)

  const reload = () => {
    listTrials().then(setTrials).catch(() => {})
    listScheduleEvents().then(setEvents).catch(() => {})
  }
  useEffect(() => { reload() }, [])
  // 当前时间红线：每分钟刷新
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // ── 本周（周一~周日）日期数组 ────────────────────────────────────────────────
  const weekDates = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const dow = today.getDay()                    // 0=周日
    const diffToMon = dow === 0 ? -6 : 1 - dow
    const mon = addDays(today, diffToMon + weekOffset * 7)
    return Array.from({ length: 7 }, (_, i) => toISO(addDays(mon, i)))
  }, [weekOffset])

  const weekSet = useMemo(() => new Set(weekDates), [weekDates])
  const todayISO = toISO(new Date())

  // ── 收集本周所有块 ──────────────────────────────────────────────────────────
  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = []
    for (const s of students) {
      const isZhongFang = s.supervisorId ? supervisorById.get(s.supervisorId)?.saType === '中方SA' : false
      for (const sess of (s.sessions ?? []) as SessionRecord[]) {
        if (!weekSet.has(sess.date)) continue
        if (sess.type !== 'SA_MEETING' && sess.type !== 'TA_MEETING' && sess.type !== 'THEORY') continue
        const isSA = sess.type === 'SA_MEETING'
        const isDefense = isSA && sess.isFinalDefense
        const isYingfangAttending = isSA && !isDefense && !isZhongFang && !!sess.tutorAttending
        const color = isSA
          ? (isDefense
              ? (isZhongFang ? SA_ZHONGFANG_DEFENSE_COLOR : SA_YINGFANG_DEFENSE_COLOR)
              : (isZhongFang ? SA_ZHONGFANG_COLOR : (isYingfangAttending ? SA_YINGFANG_ATTENDING_COLOR : SESSION_COLOR.SA_MEETING)))
          : SESSION_COLOR[sess.type]
        // 英方平时 SA（非答辩、非出席）弱化为浅灰底，需要深色字才看得清
        const textColor = isSA && !isDefense && !isZhongFang && !isYingfangAttending ? SA_DIMMED_TEXT : undefined
        const label = isDefense ? '答辩' : SESSION_LABEL[sess.type]
        // 英方SA 平时会议导师不出席 → 不占用导师时间
        const occupies = !(isSA && !isDefense && !isZhongFang && !isYingfangAttending)
        out.push({
          key: `sess-${sess.id}`, kind: 'session', date: sess.date,
          startMin: parseMin(sess.time), durationMin: sess.durationMinutes || 60,
          label: `${label} · ${s.name}`, time: sess.time, color, textColor, occupies,
          studentId: s.id, studentName: s.name, sessionId: sess.id,
        })
      }
    }
    for (const t of trials) {
      if (!weekSet.has(t.date)) continue
      out.push({
        key: `trial-${t.id}`, kind: 'trial', date: t.date,
        startMin: parseMin(t.time), durationMin: t.durationMinutes || 60,
        label: `试听 · ${t.studentName || '—'}`, time: t.time, color: TRIAL_COLOR, occupies: true,
        trialId: t.id,
      })
    }
    for (const e of events) {
      if (!weekSet.has(e.date)) continue
      out.push({
        key: `event-${e.id}`, kind: 'event', date: e.date,
        // 加个班儿默认 0 分钟（事后补时长），日历里按 60 分钟高度画，否则点都点不着
        startMin: parseMin(e.time), durationMin: e.durationMinutes || 60,
        label: e.title || '(无标题)', time: e.time,
        color: e.countsAsOvertime ? OT_EVENT_COLOR : EVENT_COLOR, occupies: true,
        event: e,
      })
    }
    return out
  }, [students, supervisorById, trials, events, weekSet])

  // 占用模式只保留真正占用导师的安排
  const shown = busyMode ? blocks.filter(b => b.occupies) : blocks
  const timed = shown.filter(b => b.startMin !== null)
  const untimed = shown.filter(b => b.startMin === null)

  // ── 动态时间轴范围 ──────────────────────────────────────────────────────────
  const { axisStart, axisEnd } = useMemo(() => {
    let lo = DEFAULT_START, hi = DEFAULT_END
    for (const b of timed) {
      const s = b.startMin as number
      const e = s + b.durationMin
      if (s < lo) lo = Math.floor(s / 60) * 60
      if (e > hi) hi = Math.ceil(e / 60) * 60
    }
    return { axisStart: lo, axisEnd: hi }
  }, [timed])

  const gridHeight = ((axisEnd - axisStart) / 60) * HOUR_H
  const hours = Array.from({ length: Math.ceil((axisEnd - axisStart) / 60) + 1 }, (_, i) => axisStart + i * 60)
  const halfHours = hours.slice(0, -1).map(h => h + 30)

  const clickEmpty = (date: string, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const raw = axisStart + (y / HOUR_H) * 60
    const snapped = Math.round(raw / 30) * 30           // 半小时吸附
    setCreatePrefill({ date, time: fmtMin(Math.max(axisStart, Math.min(axisEnd - 30, snapped))) })
  }

  return (
    <div className="relative">
      {editSession && (
        <QuickSessionEditPopover
          studentId={editSession.studentId} studentName={editSession.studentName} sessionId={editSession.sessionId}
          onClose={() => setEditSession(null)} onSaved={() => { setEditSession(null); reload() }}
        />
      )}
      {editEvent && (
        <QuickEventEditPopover
          event={editEvent} onClose={() => setEditEvent(null)} onSaved={() => { setEditEvent(null); reload() }}
        />
      )}
      {createPrefill && (
        <ScheduleCreateDialog
          students={students} supervisors={supervisors} prefill={createPrefill}
          onClose={() => setCreatePrefill(null)} onSaved={() => { setCreatePrefill(null); reload() }}
        />
      )}

      {/* ── 顶部：翻页 + 新建 ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
          <button onClick={() => setWeekOffset(o => o - 1)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">‹</button>
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 border-x border-gray-200">
            {weekOffset === 0 ? '本周' : '回到本周'}
          </button>
          <button onClick={() => setWeekOffset(o => o + 1)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">›</button>
        </div>
        <span className="text-sm text-gray-500">{weekDates[0].slice(5)} – {weekDates[6].slice(5)}</span>
        {!busyMode && (
        <div className="flex items-center gap-3 ml-2 text-xs text-gray-400">
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: SESSION_COLOR.SA_MEETING }} />SA</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: SESSION_COLOR.TA_MEETING }} />TA</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: SESSION_COLOR.THEORY }} />理论</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: TRIAL_COLOR }} />试听</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: EVENT_COLOR }} />事件</span>
          <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: OT_EVENT_COLOR }} />加班</span>
        </div>
        )}
        <button
          onClick={() => setBusyMode(v => !v)}
          title="所有安排统一显示为灰色「占用」，隐去姓名与类型，方便截图发给学生看空闲时段"
          className={`ml-auto text-xs px-3 py-1.5 rounded-lg border transition-colors ${
            busyMode
              ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
          }`}
        >
          {busyMode ? '🙈 占用模式' : '只看占用'}
        </button>
        <button
          onClick={() => setCreatePrefill({ date: weekDates.includes(todayISO) ? todayISO : weekDates[0], time: '09:00' })}
          className="text-sm px-4 py-1.5 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors"
        >
          + 新建
        </button>
      </div>

      {/* ── 星期表头 ──────────────────────────────────────────────────────── */}
      <div className="flex border-b border-gray-200">
        <div className="w-12 shrink-0" />
        {weekDates.map(iso => {
          const isToday = iso === todayISO
          const dow = new Date(iso + 'T12:00:00').getDay()
          const isWknd = dow === 0 || dow === 6
          return (
            <div key={iso} className={`flex-1 text-center py-1.5 text-xs border-l border-gray-100 ${
              isToday ? 'bg-[var(--primary)] text-white font-bold' : isWknd ? 'text-gray-400' : 'text-gray-600'
            }`}>
              <div>周{WEEKDAY[dow === 0 ? 6 : dow - 1]}</div>
              <div>{iso.slice(5)}</div>
            </div>
          )
        })}
      </div>

      {/* ── 未定时带（只装历史遗留无时间块） ──────────────────────────────── */}
      {untimed.length > 0 && (
        <div className="flex border-b border-gray-200 bg-gray-50/60">
          <div className="w-12 shrink-0 flex items-center justify-center text-[10px] text-gray-400">未定时</div>
          {weekDates.map(iso => (
            <div key={iso} className="flex-1 border-l border-gray-100 p-1 flex flex-col gap-1 min-h-[28px]">
              {untimed.filter(b => b.date === iso).map(b => {
                const text = busyMode ? BUSY_LABEL : b.label
                return (
                  <button key={b.key} onClick={() => openBlock(b)}
                    className="text-left text-[11px] text-white rounded px-1.5 py-0.5 truncate"
                    style={{ background: busyMode ? BUSY_COLOR : b.color, opacity: 0.9, color: busyMode ? '#fff' : (b.textColor ?? '#fff') }} title={text}>
                    {text}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── 时间轴网格 ────────────────────────────────────────────────────── */}
      <div className="flex" style={{ height: gridHeight }}>
        {/* 时间刻度 */}
        <div className="w-12 shrink-0 relative">
          {hours.map(h => (
            <div key={h} className="absolute right-1 text-[10px] text-gray-400 -translate-y-1/2"
              style={{ top: ((h - axisStart) / 60) * HOUR_H }}>
              {fmtMin(h)}
            </div>
          ))}
          {halfHours.map(h => (
            <div key={`half-${h}`} className="absolute right-1 text-[9px] text-gray-300 -translate-y-1/2"
              style={{ top: ((h - axisStart) / 60) * HOUR_H }}>
              :30
            </div>
          ))}
        </div>

        {/* 天列 */}
        {weekDates.map(iso => {
          const dow = new Date(iso + 'T12:00:00').getDay()
          const isWeekday = dow >= 1 && dow <= 5
          const isToday = iso === todayISO
          const dayTimed = timed.filter(b => b.date === iso)
          const laid = busyMode
            ? mergeBusyIntervals(dayTimed).map(b => ({ b, lane: 0, cols: 1 }))
            : layoutDay(dayTimed)
          const nowMin = now.getHours() * 60 + now.getMinutes()
          const showNow = isToday && nowMin >= axisStart && nowMin <= axisEnd
          return (
            <div key={iso} className="flex-1 relative border-l border-gray-100"
              onClick={e => clickEmpty(iso, e)}>
              {/* 工作时间高亮（仅工作日） */}
              {isWeekday && WORK_BANDS.map(([ws, we], i) => {
                const top = ((Math.max(ws, axisStart) - axisStart) / 60) * HOUR_H
                const h = ((Math.min(we, axisEnd) - Math.max(ws, axisStart)) / 60) * HOUR_H
                if (h <= 0) return null
                return <div key={i} className="absolute inset-x-0 pointer-events-none" style={{ top, height: h, background: WORK_BG }} />
              })}
              {/* 小时横线 */}
              {hours.map(h => (
                <div key={h} className="absolute inset-x-0 pointer-events-none"
                  style={{ top: ((h - axisStart) / 60) * HOUR_H, borderTop: `1px solid ${HOUR_LINE}` }} />
              ))}
              {/* 半小时淡线 —— 方便读出具体时间格 */}
              {halfHours.map(h => (
                <div key={`half-${h}`} className="absolute inset-x-0 pointer-events-none"
                  style={{ top: ((h - axisStart) / 60) * HOUR_H, borderTop: `1px dashed ${HALF_HOUR_LINE}` }} />
              ))}
              {/* 块 */}
              {laid.map(({ b, lane, cols }) => {
                const top = (((b.startMin as number) - axisStart) / 60) * HOUR_H
                const h = Math.max(MIN_BLOCK_H, (b.durationMin / 60) * HOUR_H)
                const widthPct = 100 / cols
                const text = busyMode ? BUSY_LABEL : b.label
                return (
                  <button key={b.key}
                    onClick={busyMode ? undefined : ev => { ev.stopPropagation(); openBlock(b) }}
                    className={`absolute rounded-md px-1.5 py-0.5 text-white text-left overflow-hidden shadow-sm transition-all z-10 ${busyMode ? 'cursor-default' : 'hover:brightness-105'}`}
                    style={{
                      top, height: h - 2, left: `calc(${lane * widthPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`,
                      background: busyMode ? BUSY_COLOR : b.color,
                      color: busyMode ? '#fff' : (b.textColor ?? '#fff'),
                    }}
                    title={`${fmtRange(b)} ${text}`}
                  >
                    <div className="text-[11px] font-semibold leading-tight truncate">{text}</div>
                    {h > 30 && b.startMin !== null && (
                      <div className="text-[10px] opacity-90 leading-tight truncate">{fmtRange(b)}</div>
                    )}
                  </button>
                )
              })}
              {/* 当前时间线：压在色块上时红色对比度不够，改白色 */}
              {showNow && (() => {
                const onColorBlock = laid.some(({ b }) =>
                  nowMin >= (b.startMin as number) && nowMin < (b.startMin as number) + b.durationMin
                )
                const lineColor = onColorBlock ? '#fff' : '#ef4444'
                return (
                  <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: ((nowMin - axisStart) / 60) * HOUR_H }}>
                    <div className="h-0.5" style={{ background: lineColor }} />
                    <div className="absolute -left-0 -top-1 w-2 h-2 rounded-full" style={{ background: lineColor }} />
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {shown.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-8">本周暂无安排。点空白格新建（个人事件 / 课程），或从学生页/甘特图排课。</p>
      )}
    </div>
  )

  function openBlock(b: Block) {
    if (b.kind === 'session' && b.studentId && b.sessionId) {
      setEditSession({ studentId: b.studentId, studentName: b.studentName ?? '', sessionId: b.sessionId })
    } else if (b.kind === 'trial' && b.trialId) {
      navigate(`/trials/${b.trialId}`)
    } else if (b.kind === 'event' && b.event) {
      setEditEvent(b.event)
    }
  }
}

// ── 占用模式：相邻/重叠的块合并成一整条灰块，不再逐个露边界 ──────────────────────
function mergeBusyIntervals(dayBlocks: Block[]): Block[] {
  const sorted = [...dayBlocks].sort((a, b) => (a.startMin as number) - (b.startMin as number))
  const merged: Block[] = []
  for (const b of sorted) {
    const start = b.startMin as number
    const end = start + b.durationMin
    const last = merged[merged.length - 1]
    const lastEnd = last ? (last.startMin as number) + last.durationMin : -1
    if (last && start <= lastEnd) {
      last.durationMin = Math.max(lastEnd, end) - (last.startMin as number)
    } else {
      merged.push({ ...b, key: `busy-${b.date}-${start}` })
    }
  }
  return merged
}

// ── 撞车并排：给同一天的定时块分车道 ──────────────────────────────────────────
function layoutDay(dayBlocks: Block[]): { b: Block; lane: number; cols: number }[] {
  const items = dayBlocks
    .map(b => ({ b, start: b.startMin as number, end: (b.startMin as number) + b.durationMin }))
    .sort((a, z) => a.start - z.start || a.end - z.end)

  const result: { b: Block; lane: number; cols: number }[] = []
  let cluster: typeof items = []
  let clusterEnd = -1

  const flush = () => {
    const laneEnds: number[] = []
    const laneOf = new Map<Block, number>()
    for (const it of cluster) {
      let lane = laneEnds.findIndex(end => it.start >= end)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end) }
      else laneEnds[lane] = it.end
      laneOf.set(it.b, lane)
    }
    const cols = laneEnds.length
    for (const it of cluster) result.push({ b: it.b, lane: laneOf.get(it.b) ?? 0, cols })
    cluster = []
    clusterEnd = -1
  }

  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  flush()
  return result
}
