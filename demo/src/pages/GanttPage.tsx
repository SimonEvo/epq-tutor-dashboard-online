import type { Page, Student } from '../types'
import { ROUNDS, daysUntil, effectiveDeadline, parseDate } from '../utils'

interface Props {
  students: Student[]
  round: string
  nav: (p: Page) => void
}

export default function GanttPage({ students, round, nav }: Props) {
  const visible = students.filter((s) => s.round === round && !s.wrappedUp)
  const today = new Date('2026-09-21T00:00:00')
  const days: Date[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    days.push(d)
  }
  const toISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>甘特视图</h1>
          <p className="muted">未来 14 天 · 学期 {round} · 只读（编辑功能未包含在 Demo 中）</p>
        </div>
      </header>

      <div className="gantt">
        <div className="gantt-head">
          <div className="gantt-name-col" />
          {days.map((d, i) => (
            <div key={i} className={`gantt-day ${i === 0 ? 'today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}`}>
              <div className="day-num">{d.getDate()}</div>
              <div className="day-week">{'日一二三四五六'[d.getDay()]}</div>
            </div>
          ))}
        </div>
        {visible.map((s) => {
          const ddl = effectiveDeadline(s, ROUNDS)
          return (
            <div key={s.id} className="gantt-row" onClick={() => nav({ kind: 'student', id: s.id })}>
              <div className="gantt-name-col">
                <strong>{s.name}</strong>
                <span className="muted small">{s.overview}</span>
              </div>
              <div className="gantt-cells">
                {days.map((d, i) => (
                  <div key={i} className={`gantt-cell ${i === 0 ? 'today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}`} />
                ))}
                {s.ganttBars.map((b, i) => {
                  const si = dayIndex(days, parseDate(b.start))
                  const ei = dayIndex(days, parseDate(b.end))
                  if (ei < 0 || si > 13) return null
                  const left = (Math.max(0, si) * 100) / 14
                  const width = ((Math.min(13, ei) - Math.max(0, si) + 1) * 100) / 14
                  return (
                    <div key={i} className="gantt-bar" style={{ left: `${left}%`, width: `${width}%` }} title={`${b.label}: ${b.start} ~ ${b.end}`}>
                      <span>{b.label}</span>
                    </div>
                  )
                })}
                {s.ganttDiamonds.map((dm, i) => {
                  const di = dayIndex(days, parseDate(dm.date))
                  if (di < 0 || di > 13) return null
                  return (
                    <div key={i} className="gantt-diamond" style={{ left: `${((di + 0.5) * 100) / 14}%` }} title={`${dm.label}: ${dm.date}`}>
                      ◆
                    </div>
                  )
                })}
                {ddl && (() => {
                  const di = dayIndex(days, parseDate(ddl))
                  if (di < 0 || di > 13) return null
                  return (
                    <div key="ddl" className="gantt-diamond ddl" style={{ left: `${((di + 0.5) * 100) / 14}%` }} title={`提交截止: ${ddl}`}>
                      ⏰
                    </div>
                  )
                })()}
              </div>
            </div>
          )
        })}
        {visible.length === 0 && <p className="muted" style={{ padding: 16 }}>该学期暂无在读学生</p>}
      </div>
      <p className="muted small legend">
        ▬ 时间段（考试/出行/准备窗口） · ◆ 事件标记 · ⏰ 提交截止 · 绿框列 = 今天（9/21）
      </p>
    </div>
  )
}

function dayIndex(days: Date[], target: Date): number {
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  for (let i = 0; i < days.length; i++) {
    if (days[i].getTime() === t) return i
  }
  // 不在窗口内：返回相对位置（负=之前，>13=之后）
  return t < days[0].getTime() ? -1 : 14
}
