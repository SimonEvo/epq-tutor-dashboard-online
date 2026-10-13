import { useMemo, useState } from 'react'
import type { Student } from '../types'
import { TODAY, fmtDate, fmtMinutes, saCountUsed, saMinutesUsed } from '../utils'

interface Props {
  students: Student[]
  round: string
}

/** 演示版"AI 周报"：本地模板拼装，不调用任何真实 AI */
export default function ReportPage({ students, round }: Props) {
  const visible = students.filter((s) => s.round === round)
  const [copied, setCopied] = useState(false)

  const report = useMemo(() => {
    const weekAgo = new Date(TODAY.getTime() - 7 * 86400000)
    const lines: string[] = []
    lines.push(`# EPQ 教学周报（演示）`)
    lines.push(`生成时间：${TODAY.getFullYear()}/${TODAY.getMonth() + 1}/${TODAY.getDate()} · 学期 ${round}`)
    lines.push('')
    lines.push(`本周在读学生 ${visible.length} 人。`)
    lines.push('')
    for (const s of visible) {
      const weekSessions = s.sessions
        .map((x) => ({ ...x, _d: new Date(x.date + 'T00:00:00') }))
        .filter((x) => x._d >= weekAgo)
      const saUsed = saCountUsed(s)
      lines.push(`## ${s.name}（${s.overview || s.topic}）`)
      if (weekSessions.length === 0) {
        lines.push(`本周无课。SA 课次 ${saUsed}/${s.saHoursTotal}，累计 SA 时长 ${fmtMinutes(saMinutesUsed(s))}。`)
      } else {
        for (const ses of weekSessions) {
          lines.push(`- ${ses.date} ${ses.type === 'SA_MEETING' ? 'SA课' : ses.type === 'TA_MEETING' ? 'TA课' : '理论课'} ${fmtMinutes(ses.durationMinutes)}：${ses.summary}`)
        }
        const hw = weekSessions.flatMap((x) => x.homework)
        const undone = hw.filter((h) => !h.done)
        if (undone.length > 0) lines.push(`- 待交作业：${undone.map((h) => h.label).join('；')}`)
        lines.push(`- SA 课次 ${saUsed}/${s.saHoursTotal}，累计 ${fmtMinutes(saMinutesUsed(s))}。`)
      }
      if (s.scheduleNote) lines.push(`- 日程备注：${s.scheduleNote}`)
      lines.push('')
    }
    lines.push(`> 本报告由 Demo 模板本地生成，仅展示"AI 周报"功能的形态；正式版将由 AI 生成总结性文字。`)
    return lines.join('\n')
  }, [visible, round])

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>AI 周报</h1>
          <p className="muted">演示版为本地模板生成 · 数据覆盖 {fmtDate(new Date(TODAY.getTime() - 7 * 86400000).toISOString())} 以来</p>
        </div>
        <button
          className="primary-btn"
          onClick={() => {
            navigator.clipboard.writeText(report).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? '✓ 已复制' : '复制全文'}
        </button>
      </header>
      <pre className="report-pre">{report}</pre>
    </div>
  )
}
