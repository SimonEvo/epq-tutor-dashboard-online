import { useEffect, useState } from 'react'
import {
  listManualLogs, createManualLog, updateManualLog, deleteManualLog,
  listWorkflowAnalyses, fillAnalysis, listActionLogs,
} from '@/lib/dataService'
import { generateWorkflowAnalysis } from '@/lib/workflowAnalysisService'
import type { ManualLog, WorkflowAnalysis } from '@/types'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function formatDateTimeLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localToIso(local: string): string {
  // local is "YYYY-MM-DDTHH:MM"
  if (!local) return new Date().toISOString()
  return new Date(local).toISOString()
}

export default function WorkflowAnalysisPage() {
  const [analyses, setAnalyses] = useState<WorkflowAnalysis[]>([])
  const [manualLogs, setManualLogs] = useState<ManualLog[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  // Manual log form
  const [newDesc, setNewDesc] = useState('')
  const [newOccurred, setNewOccurred] = useState(formatDateTimeLocal(new Date().toISOString()))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [editOccurred, setEditOccurred] = useState('')

  // Expanded history items
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const refresh = async () => {
    try {
      const [a, m] = await Promise.all([listWorkflowAnalyses(), listManualLogs()])
      setAnalyses(a)
      setManualLogs(m)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  // Auto-generate if a pending row exists
  useEffect(() => {
    if (loading || generating) return
    const pending = analyses.find(a => a.status === 'pending')
    if (!pending) return
    handleGenerate(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, analyses])

  const handleGenerate = async (analysis: WorkflowAnalysis) => {
    setGenerating(true)
    setError('')
    try {
      const actions = await listActionLogs(analysis.periodStart, analysis.periodEnd)
      const periodLogs = manualLogs.filter(m =>
        m.occurredAt >= analysis.periodStart && m.occurredAt <= analysis.periodEnd
      )
      const content = await generateWorkflowAnalysis(
        analysis.periodStart, analysis.periodEnd, actions, periodLogs,
      )
      await fillAnalysis(analysis.id, content)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  const handleAddManual = async () => {
    if (!newDesc.trim()) return
    try {
      await createManualLog({
        id: generateId(),
        occurredAt: localToIso(newOccurred),
        description: newDesc.trim(),
        createdAt: '',
        updatedAt: '',
      })
      setNewDesc('')
      setNewOccurred(formatDateTimeLocal(new Date().toISOString()))
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  const startEdit = (m: ManualLog) => {
    setEditingId(m.id)
    setEditDesc(m.description)
    setEditOccurred(formatDateTimeLocal(m.occurredAt))
  }

  const handleSaveEdit = async (m: ManualLog) => {
    try {
      await updateManualLog({
        ...m,
        occurredAt: localToIso(editOccurred),
        description: editDesc.trim(),
      })
      setEditingId(null)
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDeleteManual = async (id: string) => {
    if (!confirm('删除这条手动日志？')) return
    await deleteManualLog(id)
    await refresh()
  }

  // Force-trigger a new analysis (dev convenience): not exposed in normal UI
  // Could be added later as a debug button if needed

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  const generated = analyses.filter(a => a.status === 'generated')
  const latest = generated[0]
  const history = generated.slice(1)
  const pending = analyses.find(a => a.status === 'pending')

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">工作流分析</h1>
        <p className="text-xs text-gray-400">每 14 天自动生成</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-600">{error}</div>
      )}

      {/* ── Current / latest report ── */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">最新报告</h2>
          {(pending || generating) && (
            <span className="text-xs text-[var(--primary)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-pulse" />
              {generating ? 'AI 正在分析…' : '待生成'}
            </span>
          )}
        </div>

        {generating && (
          <p className="text-sm text-gray-400">正在调用 AI 分析行为日志，请稍候…</p>
        )}

        {!generating && pending && !latest && (
          <p className="text-sm text-gray-400">系统已检测到需要生成新报告，正在准备…</p>
        )}

        {!generating && latest && (
          <>
            <p className="text-xs text-gray-400 mb-3">
              覆盖周期 {latest.periodStart.slice(0, 10)} ~ {latest.periodEnd.slice(0, 10)} ·
              生成于 {latest.generatedAt?.slice(0, 16).replace('T', ' ')}
            </p>
            <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
              {latest.content}
            </pre>
          </>
        )}

        {!generating && !latest && !pending && (
          <p className="text-sm text-gray-400">暂无报告。系统会在数据积累 14 天后自动生成第一份。</p>
        )}
      </section>

      {/* ── Manual log ── */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">手动日志</h2>
        <p className="text-xs text-gray-400 mb-3">
          记录系统没有自动捕获的工作（备课、电话、写邮件等）。可以回忆补录。
        </p>

        {/* New entry */}
        <div className="flex flex-col gap-2 mb-4">
          <textarea
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="刚刚 / 之前做了什么？"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] min-h-[60px] resize-y"
          />
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={newOccurred}
              onChange={e => setNewOccurred(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            <button
              onClick={handleAddManual}
              disabled={!newDesc.trim()}
              className="text-sm px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-40 transition-colors ml-auto"
            >
              添加
            </button>
          </div>
        </div>

        {/* Recent entries */}
        {manualLogs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">还没有手动日志。</p>
        ) : (
          <div className="space-y-2">
            {manualLogs.slice(0, 20).map(m => (
              <div key={m.id} className="border border-gray-100 rounded-xl p-3">
                {editingId === m.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 min-h-[60px] resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="datetime-local"
                        value={editOccurred}
                        onChange={e => setEditOccurred(e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1"
                      />
                      <button onClick={() => handleSaveEdit(m)} className="text-xs px-3 py-1 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] ml-auto">保存</button>
                      <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50">取消</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <p className="text-xs text-gray-400 shrink-0 mt-0.5 w-28">
                      {m.occurredAt.slice(0, 16).replace('T', ' ')}
                    </p>
                    <p className="text-sm text-gray-700 flex-1 whitespace-pre-wrap">{m.description}</p>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => startEdit(m)} className="text-xs text-gray-300 hover:text-gray-600 px-1">编辑</button>
                      <button onClick={() => handleDeleteManual(m.id)} className="text-xs text-gray-300 hover:text-red-400 px-1">删除</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {manualLogs.length > 20 && (
              <p className="text-xs text-gray-400 text-center pt-2">仅显示最近 20 条</p>
            )}
          </div>
        )}
      </section>

      {/* ── History ── */}
      {history.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">历史报告</h2>
          <div className="space-y-2">
            {history.map(h => {
              const isOpen = expanded.has(h.id)
              return (
                <div key={h.id} className="border border-gray-100 rounded-xl">
                  <button
                    onClick={() => setExpanded(prev => {
                      const next = new Set(prev)
                      if (next.has(h.id)) next.delete(h.id); else next.add(h.id)
                      return next
                    })}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                  >
                    <span className="text-sm text-gray-700">
                      {h.periodStart.slice(0, 10)} ~ {h.periodEnd.slice(0, 10)}
                    </span>
                    <span className="text-xs text-gray-400">{isOpen ? '收起' : '展开'}</span>
                  </button>
                  {isOpen && (
                    <pre className="px-3 py-3 border-t border-gray-100 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                      {h.content}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
