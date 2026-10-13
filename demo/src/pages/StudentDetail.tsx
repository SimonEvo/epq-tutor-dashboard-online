import { useState } from 'react'
import type { MilestoneStatus, Page, Session, SessionType, Student } from '../types'
import { CHECKLIST_TEMPLATE, MILESTONES, STATUS_LABEL } from '../data'
import { ROUNDS } from '../utils'
import {
  daysUntil,
  effectiveDeadline,
  fmtDate,
  fmtDateFull,
  fmtDateTime,
  fmtMinutes,
  nid,
  saCountUsed,
  saMinutesUsed,
} from '../utils'

interface Props {
  student: Student
  update: (id: string, fn: (s: Student) => Student) => void
  nav: (p: Page) => void
}

const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  SA_MEETING: 'SA 课',
  TA_MEETING: 'TA 课',
  THEORY: '理论课',
}

export default function StudentDetail({ student: s, update, nav }: Props) {
  const [tab, setTab] = useState<'sessions' | 'milestones' | 'checklist'>('sessions')

  const ddl = effectiveDeadline(s, ROUNDS)
  const ddlDays = ddl ? daysUntil(ddl) : null
  const used = saCountUsed(s)
  const minutes = saMinutesUsed(s)

  const patch = (fn: (x: Student) => Student) => update(s.id, fn)

  return (
    <div className="page">
      <button className="back-btn" onClick={() => nav({ kind: 'dashboard' })}>
        ← 返回 Dashboard
      </button>

      <header className="page-header student-head">
        <div>
          <h1>
            {s.name} <span className="muted h1-sub">{s.englishName}</span>
          </h1>
          <p className="muted">
            {s.round} · {s.saKind === 'chinese' ? '中方 SA' : '英方 SA'} · {s.topic}
          </p>
          {s.briefNote && <p className="briefnote">📝 {s.briefNote}</p>}
          {s.scheduleNote && <p className="muted small">📅 {s.scheduleNote}</p>}
        </div>
        <div className="head-actions">
          <label className="wrap-toggle">
            <input
              type="checkbox"
              checked={s.wrappedUp}
              onChange={(e) => patch((x) => ({ ...x, wrappedUp: e.target.checked }))}
            />
            已结项
          </label>
          <label className="wrap-toggle" title="切换正常/延期档截止时间（演示数据为 26秋 学期）">
            <input
              type="checkbox"
              checked={s.deadlineTier === 'extended'}
              onChange={(e) =>
                patch((x) => ({ ...x, deadlineTier: e.target.checked ? 'extended' : 'normal' }))
              }
            />
            延期一周
          </label>
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">SA 课次</div>
          <div className="stat-value">
            {used} <span className="muted">/ {s.saHoursTotal}</span>
          </div>
          <div className="muted small">剩余 {s.saHoursTotal - used} 次</div>
        </div>
        <div className="stat">
          <div className="stat-label">SA 累计时长</div>
          <div className="stat-value">{fmtMinutes(minutes)}</div>
          <div className="muted small">由课次记录自动汇总</div>
        </div>
        <div className="stat">
          <div className="stat-label">提交截止</div>
          <div className={`stat-value ${ddlDays !== null && ddlDays < 30 ? 'warn-text' : ''}`}>
            {ddl ? `D-${ddlDays}` : '待定'}
          </div>
          <div className="muted small">{ddl ? fmtDateTime(ddl) : '学期未设置'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">下次课程</div>
          <div className="stat-value small-value">
            {s.nextSA ? `SA ${fmtDate(s.nextSA)}` : '—'}
            {s.nextTA ? ` · TA ${fmtDate(s.nextTA)}` : ''}
          </div>
        </div>
      </div>

      <div className="tab-bar">
        {(['sessions', 'milestones', 'checklist'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'sessions' ? `课程记录 (${s.sessions.length})` : t === 'milestones' ? 'EPQ 里程碑' : '提交清单'}
          </button>
        ))}
      </div>

      {tab === 'sessions' && <SessionsTab s={s} patch={patch} />}
      {tab === 'milestones' && <MilestonesTab s={s} patch={patch} />}
      {tab === 'checklist' && <ChecklistTab s={s} patch={patch} />}
    </div>
  )
}

function SessionsTab({ s, patch }: { s: Student; patch: (fn: (x: Student) => Student) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<SessionType>('SA_MEETING')
  const [duration, setDuration] = useState(60)
  const [summary, setSummary] = useState('')

  const sessions = [...s.sessions].sort((a, b) => (a.date < b.date ? 1 : -1))

  const add = () => {
    if (!summary.trim()) return
    const today = fmtDateFull(new Date().toISOString())
    const ses: Session = { id: nid('ses'), date: today, type, durationMinutes: duration, summary: summary.trim(), homework: [] }
    patch((x) => ({ ...x, sessions: [...x.sessions, ses] }))
    setSummary('')
    setShowForm(false)
  }

  return (
    <div>
      <button className="primary-btn" onClick={() => setShowForm(!showForm)}>
        + 记录课程（演示）
      </button>
      {showForm && (
        <div className="inline-form">
          <select value={type} onChange={(e) => setType(e.target.value as SessionType)}>
            <option value="SA_MEETING">SA 课</option>
            <option value="TA_MEETING">TA 课</option>
            <option value="THEORY">理论课</option>
          </select>
          <input
            type="number"
            min={15}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span className="muted">分钟</span>
          <input
            placeholder="课堂摘要…"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="primary-btn" onClick={add}>
            保存
          </button>
        </div>
      )}
      <div className="session-list">
        {sessions.map((ses) => (
          <div key={ses.id} className="session-item">
            <div className="session-head">
              <span className={`type-badge type-${ses.type}`}>{SESSION_TYPE_LABEL[ses.type]}</span>
              <span className="muted small">
                {ses.date} · {fmtMinutes(ses.durationMinutes)}
              </span>
              <button
                className="del-btn"
                title="删除（演示）"
                onClick={() =>
                  patch((x) => ({ ...x, sessions: x.sessions.filter((y) => y.id !== ses.id) }))
                }
              >
                ✕
              </button>
            </div>
            <p>{ses.summary}</p>
            {ses.homework.length > 0 && (
              <ul className="hw-list">
                {ses.homework.map((h, i) => (
                  <li key={i}>
                    <label>
                      <input
                        type="checkbox"
                        checked={h.done}
                        onChange={(e) =>
                          patch((x) => ({
                            ...x,
                            sessions: x.sessions.map((y) =>
                              y.id === ses.id
                                ? {
                                    ...y,
                                    homework: y.homework.map((z, j) =>
                                      j === i ? { ...z, done: e.target.checked } : z,
                                    ),
                                  }
                                : y,
                            ),
                          }))
                        }
                      />
                      <span className={h.done ? 'done' : ''}>{h.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {sessions.length === 0 && <p className="muted">暂无课程记录</p>}
      </div>
    </div>
  )
}

const NEXT_STATUS: Record<MilestoneStatus, MilestoneStatus> = {
  not_started: 'in_progress',
  in_progress: 'completed',
  completed: 'not_started',
  na: 'not_started',
}

function MilestonesTab({ s, patch }: { s: Student; patch: (fn: (x: Student) => Student) => void }) {
  const groups = ['章节', '官方表格', '流程'] as const
  return (
    <div>
      <p className="muted small">点击格子循环切换状态：未开始 → 进行中 → 已完成。演示环境直接生效。</p>
      <div className="milestone-grid">
        {groups.map((g) => (
          <div key={g} className="milestone-group">
            <h3>{g}</h3>
            <div className="milestone-cells">
              {MILESTONES.filter((m) => m.group === g).map((m) => {
                const st = s.milestones[m.id] ?? 'not_started'
                return (
                  <button
                    key={m.id}
                    className={`mcell st-${st}`}
                    onClick={() =>
                      patch((x) => ({
                        ...x,
                        milestones: { ...x.milestones, [m.id]: NEXT_STATUS[x.milestones[m.id] ?? 'not_started'] },
                      }))
                    }
                  >
                    <span className="mcell-label">{m.label}</span>
                    <span className="mcell-status">{STATUS_LABEL[st]}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChecklistTab({ s, patch }: { s: Student; patch: (fn: (x: Student) => Student) => void }) {
  const thirdPlus = s.tiiChecks.length >= 3
  return (
    <div>
      <h3>提交前检查清单</h3>
      {CHECKLIST_TEMPLATE.map((item) => (
        <label key={item.id} className="check-row">
          <input
            type="checkbox"
            checked={s.checklist.includes(item.id)}
            onChange={(e) =>
              patch((x) => ({
                ...x,
                checklist: e.target.checked
                  ? [...x.checklist, item.id]
                  : x.checklist.filter((c) => c !== item.id),
              }))
            }
          />
          <span>{item.label}</span>
        </label>
      ))}
      <h3 style={{ marginTop: 24 }}>Tii 检测记录</h3>
      {s.tiiChecks.length === 0 && <p className="muted small">暂无检测记录</p>}
      {s.tiiChecks.map((c, i) => (
        <div key={i} className={`tii-row ${i >= 2 ? 'tii-warn' : ''}`}>
          <span className="muted">{c.date}</span>
          <span>AI {c.aiPercent ?? '—'}%</span>
          <span>相似 {c.similarityPercent ?? '—'}%</span>
          <span className="muted small">{c.note}</span>
        </div>
      ))}
      {thirdPlus && <p className="warn-text small">⚠️ 已检测 3 次以上，请注意控制检测次数</p>}
    </div>
  )
}
