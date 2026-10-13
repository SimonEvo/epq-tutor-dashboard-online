import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  applyHrSync, previewHrSync, type HrSyncPreview, type HrSyncRow,
} from '@/lib/dataService'
import { useStudentStore } from '@/stores/studentStore'

type Action = 'create' | 'update' | 'link' | 'skip'

const CATEGORY: Record<HrSyncRow['category'], { label: string; cls: string }> = {
  new: { label: '新建', cls: 'bg-green-50 text-green-700 border-green-200' },
  update: { label: '更新', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  link: { label: '关联已有', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  conflict: { label: '需确认', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
}

/**
 * 默认动作。几条刻意保守的选择：
 *  - 冲突行一律跳过，逼人工看一眼
 *  - 教务已标记退出的学生，新建默认跳过（没必要把退出的人拉进来）
 *  - 无变化的更新行也跳过
 */
function defaultAction(r: HrSyncRow): Action {
  if (r.category === 'conflict') return 'skip'
  if (r.category === 'new') return r.exited ? 'skip' : 'create'
  if (r.category === 'link') return 'link'
  return r.diffs.length ? 'update' : 'skip'
}

function fmt(iso: string): string {
  if (!iso) return '从未'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

export default function HrSyncPage() {
  const navigate = useNavigate()
  const fetchAll = useStudentStore(s => s.fetchAll)
  const [preview, setPreview] = useState<HrSyncPreview | null>(null)
  const [actions, setActions] = useState<Record<string, Action>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ created: number; updated: number; linked: number; skipped: number } | null>(null)

  const load = async () => {
    setBusy(true); setError(''); setDone(null)
    try {
      const p = await previewHrSync()
      setPreview(p)
      setActions(Object.fromEntries(p.rows.map(r => [r.code, defaultAction(r)])))
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [])

  const counts = useMemo(() => {
    const c = { create: 0, update: 0, link: 0, skip: 0 }
    Object.values(actions).forEach(a => { c[a] += 1 })
    return c
  }, [actions])

  const apply = async () => {
    if (!preview) return
    setBusy(true); setError('')
    try {
      // 只传「哪个编号、做什么」。字段由后端从教务镜像重新算，不信客户端。
      const res = await applyHrSync(preview.rows.map(r => ({
        code: r.code, action: actions[r.code] ?? 'skip', studentId: r.matchedStudentId,
      })))
      setDone(res)
      await fetchAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }

  const options = (r: HrSyncRow): [Action, string][] => {
    const o: [Action, string][] = [['skip', '跳过']]
    if (r.category === 'new' || r.category === 'conflict') o.push(['create', '新建'])
    if (r.category === 'link') o.push(['link', '关联并更新'])
    if (r.category === 'update') o.push(['update', '更新'])
    return o
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold text-gray-900">从教务同步</h1>
        <div className="flex gap-2">
          <button onClick={load} disabled={busy}
            className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            重新拉取
          </button>
          <button onClick={() => navigate('/')}
            className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">返回</button>
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-6">
        只同步教务里分配给你（SA / TA）的学生。教务管的字段（姓名、提交轮次）会覆盖；
        你自己写的课题、联系方式只在空着时补上；纪要、笔记、里程碑一概不碰。
        教务标记退出的学生只提示，不会被删除。
      </p>

      {busy && !preview && <p className="text-sm text-gray-400">正在从教务拉取…</p>}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {preview && !done && (
        <>
          {preview.warning && (
            <p className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {preview.warning}
            </p>
          )}
          <p className="text-xs text-gray-500 mb-4">
            教务数据更新于 {fmt(preview.lastRefreshAt)} ·
            新建 {preview.summary.new} · 更新 {preview.summary.update} ·
            关联已有 {preview.summary.link} · 需确认 {preview.summary.conflict}
          </p>

          {preview.rows.length === 0 && (
            <p className="text-sm text-gray-500">教务里目前没有分配给你的学生。</p>
          )}

          <div className="space-y-2">
            {preview.rows.map(r => (
              <div key={r.code} className="bg-white border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded border ${CATEGORY[r.category].cls}`}>
                      {CATEGORY[r.category].label}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{r.name}</span>
                    <span className="text-xs text-gray-400">{r.code} · 你是 {r.role}</span>
                    {r.exited && (
                      <span className="text-xs px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
                        教务已标记退出
                      </span>
                    )}
                  </div>
                  <select
                    value={actions[r.code] ?? 'skip'}
                    onChange={e => setActions({ ...actions, [r.code]: e.target.value as Action })}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs shrink-0"
                  >
                    {options(r).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                {r.reason && <p className="mt-2 text-xs text-gray-500">{r.reason}</p>}
                {r.diffs.length > 0 ? (
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {r.diffs.map(d => (
                        <tr key={d.field} className="border-t border-gray-50">
                          <td className="py-1 pr-3 text-gray-500 w-20">{d.label}</td>
                          <td className="py-1 pr-2 text-gray-400 line-through break-all">{d.before || '（空）'}</td>
                          <td className="py-1 text-gray-900 break-all">{d.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : r.category === 'update' && (
                  <p className="mt-2 text-xs text-gray-400">与教务一致，无需更新</p>
                )}
              </div>
            ))}
          </div>

          {preview.orphans.length > 0 && (
            <div className="mt-5 bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs font-medium text-gray-700 mb-1">教务里已不再分配给你的学生</p>
              <p className="text-xs text-gray-500 mb-2">只是提示——本地记录不会被动，要不要处理由你决定。</p>
              <ul className="text-xs text-gray-600 list-disc list-inside">
                {preview.orphans.map(o => <li key={o.studentId}>{o.name}（{o.code}）</li>)}
              </ul>
            </div>
          )}

          {preview.rows.length > 0 && (
            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={apply}
                disabled={busy || counts.create + counts.update + counts.link === 0}
                className="bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-40"
              >
                {busy ? '同步中…' : `确认同步（新建 ${counts.create} · 更新 ${counts.update} · 关联 ${counts.link}）`}
              </button>
              <span className="text-xs text-gray-500">跳过 {counts.skip} 行</span>
            </div>
          )}
        </>
      )}

      {done && (
        <section className="bg-white rounded-2xl border border-[var(--border)] p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">同步完成</h2>
          <p className="text-sm text-gray-700">
            新建 {done.created} · 更新 {done.updated} · 关联 {done.linked} · 跳过 {done.skipped}
          </p>
          <button onClick={() => navigate('/')}
            className="mt-4 bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg hover:bg-[var(--primary-hover)]">
            回到概览
          </button>
        </section>
      )}
    </div>
  )
}
