import { useMemo, useState } from 'react'
import type { Page, Student } from '../types'
import { ROUNDS } from '../utils'
import {
  daysSince,
  effectiveDeadline,
  fmtDate,
  fmtMinutes,
  lastMeetingDate,
  lastTouched,
  saCountUsed,
  saMinutesUsed,
  urgencyOf,
} from '../utils'

interface Props {
  students: Student[]
  round: string
  setRound: (r: string) => void
  nav: (p: Page) => void
}

type View = 'overview' | 'cards'

function urgencyHex(days: number | null): string {
  if (days === null) return '#9ca3af'
  if (days >= 15) return '#ef4444'
  if (days > 7) return '#f59e0b'
  return '#10b981'
}

export default function Dashboard({ students, round, setRound, nav }: Props) {
  const [view, setView] = useState<View>('overview')

  const visible = useMemo(
    () =>
      students
        .filter((s) => s.round === round && !s.wrappedUp)
        .sort((a, b) => {
          const rank = { red: 0, amber: 1, green: 2 }
          return rank[urgencyOf(a)] - rank[urgencyOf(b)]
        }),
    [students, round],
  )
  const wrapped = students.filter((s) => s.round === round && s.wrappedUp)
  const activeRounds = ROUNDS.filter((r) => !r.archived)

  return (
    <div>
      <header className="page-header">
        <div>
          <h1>学生 Dashboard</h1>
          <p className="muted">
            {visible.length} 名在读学生 · 当前学期 {round}
          </p>
        </div>
        <div className="view-switch">
          <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>
            概览行
          </button>
          <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>
            卡片
          </button>
        </div>
      </header>

      <div className="round-tabs">
        {activeRounds.map((r) => (
          <button key={r.name} className={round === r.name ? 'active' : ''} onClick={() => setRound(r.name)}>
            {r.name}
          </button>
        ))}
      </div>

      {view === 'overview' ? (
        <OverviewTable students={visible} onOpen={(id) => nav({ kind: 'student', id })} />
      ) : (
        <div className="card-grid">
          {visible.map((s) => (
            <StudentCard key={s.id} s={s} onClick={() => nav({ kind: 'student', id: s.id })} />
          ))}
        </div>
      )}

      {view === 'cards' && visible.length === 0 && <EmptyState round={round} />}

      {wrapped.length > 0 && (
        <details className="wrapped-group">
          <summary>已结项 ({wrapped.length})</summary>
          {wrapped.map((s) => (
            <div key={s.id} className="wrapped-row" onClick={() => nav({ kind: 'student', id: s.id })}>
              <span className="muted">✓</span> {s.name} <span className="muted">{s.overview}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

function EmptyState({ round }: { round: string }) {
  return (
    <div className="empty">
      <p>学期「{round}」暂无在读学生。</p>
      <p className="muted">提示：26春 批次已在演示数据中归档，可点侧栏「重置演示数据」重新体验。</p>
    </div>
  )
}

/* ── Overview table（对齐正式版 OverviewView） ── */
function OverviewTable({ students, onOpen }: { students: Student[]; onOpen: (id: string) => void }) {
  return (
    <div className="ov-table">
      <div className="ov-head">
        <div className="ov-pad" />
        <TH>姓名</TH>
        <TH>英文名</TH>
        <TH>简介</TH>
        <TH>上次开会</TH>
        <TH>上次更新</TH>
        <TH>SA 剩余</TH>
        <TH>下次课</TH>
        <TH>DDL</TH>
        <TH>备注</TH>
      </div>
      {students.map((s, idx) => (
        <OverviewRow key={s.id} s={s} zebra={idx % 2 === 1} onClick={() => onOpen(s.id)} />
      ))}
      {students.length === 0 && (
        <div className="ov-row" style={{ cursor: 'default' }}>
          <div className="ov-pad" />
          <span className="muted">暂无学生</span>
        </div>
      )}
    </div>
  )
}

function TH({ children }: { children: React.ReactNode }) {
  return <div className="ov-th">{children}</div>
}

function OverviewRow({ s, zebra, onClick }: { s: Student; zebra: boolean; onClick: () => void }) {
  const last = lastMeetingDate(s)
  const lastDays = last ? daysSince(last) : null
  const accent = urgencyHex(lastDays)
  const touched = lastTouched(s)

  const saUsed = saCountUsed(s)
  const saRemain = s.saHoursTotal - saUsed
  const saLow = saRemain <= 2
  const saTotalMins = saMinutesUsed(s)

  return (
    <div className="ov-row" style={{ background: zebra ? '#f9fafb' : '#ffffff' }} onClick={onClick}>
      <div className="ov-strip" style={{ background: accent }} />
      <div className="ov-td ov-name">
        <strong>{s.name}</strong>
      </div>
      <div className="ov-td muted">{s.englishName}</div>
      <div className="ov-td">
        {s.overview ? <span className="overview-tag">{s.overview}</span> : <span className="muted">—</span>}
      </div>
      <div className="ov-td tabular">
        {last ? <span style={{ color: accent, fontWeight: 600 }}>{lastDays}d</span> : '—'}
      </div>
      <div className="ov-td tabular muted">{touched > 500 ? '—' : touched === 0 ? 'Today' : `${touched}d`}</div>
      <div className="ov-td" title={`SA 时长累计 ${fmtMinutes(saTotalMins)}`}>
        <div className="ov-sa">
          <div className="ov-sa-bar">
            <div
              className="ov-sa-fill"
              style={{ width: `${Math.max(0, Math.min(100, (saRemain / s.saHoursTotal) * 100))}%`, background: saLow ? '#ef4444' : '#10b981' }}
            />
          </div>
          <span className="small tabular" style={{ color: saLow ? '#ef4444' : '#6b7280' }}>
            {saRemain}/{s.saHoursTotal}
            {s.saKind === 'chinese' && <span className="tag-mini">中方</span>}
          </span>
        </div>
      </div>
      <div className="ov-td small">
        {s.nextSA && <div>SA {fmtDate(s.nextSA)}</div>}
        {s.nextTA && <div>TA {fmtDate(s.nextTA)}</div>}
        {!s.nextSA && !s.nextTA && <span className="muted">—</span>}
      </div>
      <div className="ov-td">
        <DeadlineChip s={s} />
      </div>
      <div className="ov-td ov-note muted">{s.briefNote || '—'}</div>
    </div>
  )
}

function DeadlineChip({ s }: { s: Student }) {
  const ddl = effectiveDeadline(s, ROUNDS)
  if (!ddl) return <span className="muted small">待定</span>
  const d = Math.ceil((new Date(ddl.replace(' ', 'T')).getTime() - Date.now()) / 86400000)
  const cls = d < 30 ? 'chip chip-red' : d < 90 ? 'chip chip-amber' : 'chip'
  return (
    <span className={cls} title={s.deadlineTier === 'extended' ? '延期档截止' : '正常档截止'}>
      {d}d{s.deadlineTier === 'extended' && '·延'}
    </span>
  )
}

/* ── Card（对齐正式版 StudentCard） ── */
function StudentCard({ s, onClick }: { s: Student; onClick: () => void }) {
  const last = lastMeetingDate(s)
  const lastDays = last ? daysSince(last) : null
  const accent = urgencyHex(lastDays)
  const doneCount = Object.values(s.milestones).filter((v) => v === 'completed').length
  const saUsed = saCountUsed(s)
  const saRemain = s.saHoursTotal - saUsed

  return (
    <div className="scard" style={{ borderLeft: `4px solid ${accent}` }} onClick={onClick}>
      <div className="scard-head">
        <div>
          <div className="scard-name">{s.name}</div>
          <div className="scard-en">{s.englishName}</div>
        </div>
        <span className="muted small tabular">
          {doneCount}/{Object.keys(s.milestones).length}
        </span>
      </div>
      {s.overview && <span className="overview-tag">{s.overview}</span>}
      <div className="scard-meta">
        <span className="muted small">上次开会 {lastDays !== null ? `${lastDays}d 前` : '—'}</span>
        <span className="muted small">
          SA 余 {saRemain}/{s.saHoursTotal}
        </span>
      </div>
      <div className="scard-dates small">
        {s.nextSA && <span>SA {fmtDate(s.nextSA)}</span>}
        {s.nextTA && <span>TA {fmtDate(s.nextTA)}</span>}
        {!s.nextSA && !s.nextTA && <span className="muted">未排课</span>}
      </div>
    </div>
  )
}
