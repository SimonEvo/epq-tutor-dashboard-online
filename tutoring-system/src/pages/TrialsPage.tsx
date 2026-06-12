import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listTrials, deleteTrial } from '@/lib/dataService'
import type { Trial, TrialOutcome } from '@/types'

type Tab = 'list' | 'stats'

const OUTCOME_LABEL: Record<TrialOutcome, string> = {
  pending: '待定',
  no_deal: '未成单',
  deal_mine: '成单·我',
  deal_other: '成单·他人',
}

const OUTCOME_COLOR: Record<TrialOutcome, string> = {
  pending: 'bg-gray-100 text-gray-500',
  no_deal: 'bg-red-50 text-red-600',
  deal_mine: 'bg-green-50 text-green-700',
  deal_other: 'bg-blue-50 text-blue-600',
}

const OUTCOME_SVG_COLOR: Record<TrialOutcome, string> = {
  pending: '#d1d5db',
  no_deal: '#f87171',
  deal_mine: '#34d399',
  deal_other: '#60a5fa',
}

function PieChart({ data }: { data: { outcome: TrialOutcome; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return <p className="text-sm text-gray-400 text-center py-8">暂无数据</p>

  const R = 80
  const cx = 100
  const cy = 100
  let angle = -Math.PI / 2

  const slices = data.filter(d => d.count > 0).map(d => {
    const sweep = (d.count / total) * 2 * Math.PI
    const start = angle
    angle += sweep
    const x1 = cx + R * Math.cos(start)
    const y1 = cy + R * Math.sin(start)
    const x2 = cx + R * Math.cos(angle)
    const y2 = cy + R * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`
    const midAngle = start + sweep / 2
    return { ...d, path, midAngle }
  })

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox="0 0 200 200" className="w-44 h-44 shrink-0">
        {slices.map(s => (
          <path key={s.outcome} d={s.path} fill={OUTCOME_SVG_COLOR[s.outcome]} stroke="white" strokeWidth="2" />
        ))}
      </svg>
      <div className="space-y-2">
        {data.map(d => (
          <div key={d.outcome} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: OUTCOME_SVG_COLOR[d.outcome] }} />
            <span className="text-gray-600">{OUTCOME_LABEL[d.outcome]}</span>
            <span className="font-medium text-gray-900 ml-1">{d.count}</span>
            {total > 0 && (
              <span className="text-gray-400 text-xs">({Math.round(d.count / total * 100)}%)</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

type Preset = 'month' | '3months' | 'year' | 'all'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export default function TrialsPage() {
  const navigate = useNavigate()
  const [trials, setTrials] = useState<Trial[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('list')
  const [sortAsc, setSortAsc] = useState(false)

  // Stats filters
  const [preset, setPreset] = useState<Preset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => {
    listTrials()
      .then(setTrials)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`删除「${name}」的试听课记录？`)) return
    await deleteTrial(id)
    setTrials(prev => prev.filter(t => t.id !== id))
  }

  const handleNew = () => {
    const id = generateId()
    navigate(`/trials/${id}`, { state: { isNew: true } })
  }

  // ── Stats helpers ──────────────────────────────────────────────────────────

  const getDateRange = (): { from: string; to: string } => {
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const to = fmt(today)
    if (preset === 'month') {
      const from = new Date(today); from.setDate(today.getDate() - 30)
      return { from: fmt(from), to }
    }
    if (preset === '3months') {
      const from = new Date(today); from.setDate(today.getDate() - 90)
      return { from: fmt(from), to }
    }
    if (preset === 'year') {
      return { from: `${today.getFullYear()}-01-01`, to }
    }
    if (preset === 'all') return { from: '', to: '' }
    return { from: customFrom, to: customTo }
  }

  const { from: dateFrom, to: dateTo } = getDateRange()

  const filteredForStats = trials.filter(t => {
    if (dateFrom && t.date < dateFrom) return false
    if (dateTo && t.date > dateTo) return false
    return true
  })

  const nonPending = filteredForStats.filter(t => t.outcome !== 'pending')
  const converted = nonPending.filter(t => t.outcome === 'deal_mine' || t.outcome === 'deal_other')
  const conversionRate = nonPending.length > 0 ? (converted.length / nonPending.length) * 100 : null

  const outcomeCounts: Record<TrialOutcome, number> = {
    pending: filteredForStats.filter(t => t.outcome === 'pending').length,
    no_deal: filteredForStats.filter(t => t.outcome === 'no_deal').length,
    deal_mine: filteredForStats.filter(t => t.outcome === 'deal_mine').length,
    deal_other: filteredForStats.filter(t => t.outcome === 'deal_other').length,
  }

  const sortedTrials = [...trials].sort((a, b) =>
    sortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
  )

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  if (error) return <div className="p-8 text-red-500 text-sm">{error}</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          试听课 <span className="text-gray-400 font-normal text-lg">({trials.length})</span>
        </h1>
        <button
          onClick={handleNew}
          className="bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
        >
          + 新建试听
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-100">
        {(['list', 'stats'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm px-4 py-2 border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-[var(--primary)] text-[var(--primary)] font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'list' ? '列表' : '统计'}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        trials.length === 0 ? (
          <div className="text-gray-400 text-sm py-16 text-center">还没有试听课记录，点击「新建试听」开始。</div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-xs text-gray-400 font-medium">
                    <button onClick={() => setSortAsc(v => !v)} className="flex items-center gap-1 hover:text-gray-600 transition-colors">
                      日期 {sortAsc ? '↑' : '↓'}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs text-gray-400 font-medium">学生姓名</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-400 font-medium">年级</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-400 font-medium">意向专业</th>
                  <th className="px-4 py-3 text-left text-xs text-gray-400 font-medium">结果</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedTrials.map(trial => (
                  <tr
                    key={trial.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/trials/${trial.id}`)}
                  >
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{trial.date}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {trial.studentName || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {trial.grade || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {trial.intendedMajor || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_COLOR[trial.outcome]}`}>
                        {OUTCOME_LABEL[trial.outcome]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(trial.id, trial.studentName)}
                        className="text-xs text-gray-300 hover:text-red-400 transition-colors px-2 py-1"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'stats' && (
        <div className="space-y-6">
          {/* Time filter */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">时间范围</p>
            <div className="flex flex-wrap gap-2 items-center">
              {([['month', '本月'], ['3months', '近3月'], ['year', '今年'], ['all', '全部']] as [Preset, string][]).map(([p, label]) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    preset === p
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="text-xs text-gray-400 ml-2">自定义：</span>
              <input
                type="date"
                value={customFrom}
                onChange={e => { setCustomFrom(e.target.value); setPreset('all') }}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
              <span className="text-xs text-gray-400">—</span>
              <input
                type="date"
                value={customTo}
                onChange={e => { setCustomTo(e.target.value); setPreset('all') }}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          </div>

          {/* Conversion rate */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">总试听</p>
              <p className="text-3xl font-semibold text-gray-900">{filteredForStats.length}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">成单率</p>
              <p className="text-3xl font-semibold text-gray-900">
                {conversionRate !== null ? `${Math.round(conversionRate)}%` : '—'}
              </p>
              <p className="text-xs text-gray-400 mt-1">{converted.length} / {nonPending.length} 已决定</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">成单给我</p>
              <p className="text-3xl font-semibold text-green-600">{outcomeCounts.deal_mine}</p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">待定</p>
              <p className="text-3xl font-semibold text-gray-400">{outcomeCounts.pending}</p>
            </div>
          </div>

          {/* Outcome breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">结果分布</p>
            <PieChart data={(Object.keys(OUTCOME_LABEL) as TrialOutcome[]).map(o => ({ outcome: o, count: outcomeCounts[o] }))} />
          </div>
        </div>
      )}
    </div>
  )
}
