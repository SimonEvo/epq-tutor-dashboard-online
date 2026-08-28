import { useEffect, useState } from 'react'
import * as dataService from '@/lib/dataService'
import type { ChecklistTemplateItem, RoundDeadlines } from '@/types'

const inputCls = 'text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white'

function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 设置页两节：提交清单模板 + 每届提交截止时间。
 *
 * 模板是活定义 —— 改一下所有学生的「提交」视图立刻跟着变。
 * 删项默认只是归档（打钩数据留着，恢复即回来）；「永久删除」才真清学生的钩。
 */
export default function SubmissionTemplateSettings({ rounds }: { rounds: string[] }) {
  const [items, setItems] = useState<ChecklistTemplateItem[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [deadlines, setDeadlines] = useState<Record<string, RoundDeadlines>>({})
  const [savingRound, setSavingRound] = useState<string | null>(null)

  useEffect(() => {
    dataService.getChecklistTemplate().then(setItems).catch(() => {})
  }, [])

  useEffect(() => {
    rounds.forEach(r => {
      dataService.getRoundDeadlines(r)
        .then(d => setDeadlines(prev => ({ ...prev, [r]: d })))
        .catch(() => {})
    })
  }, [rounds])

  const persist = async (next: ChecklistTemplateItem[]) => {
    setItems(next)   // 乐观更新
    setSaving(true)
    setError('')
    try {
      setItems(await dataService.saveChecklistTemplate(next))
    } catch (e) {
      setError(String(e))
      dataService.getChecklistTemplate().then(setItems).catch(() => {})
    } finally {
      setSaving(false)
    }
  }

  const active = items.filter(i => !i.archived).sort((a, b) => a.order - b.order)
  const archived = items.filter(i => i.archived)

  const reindex = (list: ChecklistTemplateItem[]) =>
    list.map((it, idx) => ({ ...it, order: idx }))

  const addItem = () => {
    const label = newLabel.trim()
    if (!label) return
    setNewLabel('')
    persist([...reindex(active), { id: newId(), label, order: active.length, archived: false }, ...archived])
  }

  const rename = (id: string, label: string) =>
    setItems(items.map(i => (i.id === id ? { ...i, label } : i)))

  const commitRename = () => persist(items)

  const move = (id: string, delta: number) => {
    const idx = active.findIndex(i => i.id === id)
    const target = idx + delta
    if (idx < 0 || target < 0 || target >= active.length) return
    const next = [...active]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    persist([...reindex(next), ...archived])
  }

  const archiveItem = (id: string) =>
    persist(items.map(i => (i.id === id ? { ...i, archived: true } : i)))

  const restoreItem = (id: string) =>
    persist(items.map(i => (i.id === id ? { ...i, archived: false } : i)))

  const purgeItem = async (item: ChecklistTemplateItem) => {
    if (!confirm(`永久删除「${item.label}」？所有学生身上该项的打钩数据会被一并清除，不可撤销。`)) return
    setSaving(true)
    setError('')
    try {
      setItems(await dataService.deleteChecklistItem(item.id))
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const saveDeadlines = async (round: string) => {
    setSavingRound(round)
    try {
      const saved = await dataService.saveRoundDeadlines(round, deadlines[round] ?? {})
      setDeadlines(prev => ({ ...prev, [round]: saved }))
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingRound(null)
    }
  }

  return (
    <>
      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">提交清单模板</h2>
        <p className="text-xs text-gray-400 mb-3">
          Dashboard「提交」视图的列。模板是活定义 —— 加一项，所有在读学生立刻多一个未打钩的格子。
          删除只是归档，打钩数据保留；「永久删除」才会清掉学生身上的钩。
        </p>

        {error && <div className="mb-3 text-xs text-red-600">{error}</div>}

        <ul className="space-y-2 mb-3">
          {active.map((item, idx) => (
            <li key={item.id} className="flex items-center gap-2">
              <div className="flex flex-col">
                <button
                  onClick={() => move(item.id, -1)}
                  disabled={idx === 0}
                  className="text-[10px] leading-none text-gray-300 hover:text-gray-600 disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  onClick={() => move(item.id, 1)}
                  disabled={idx === active.length - 1}
                  className="text-[10px] leading-none text-gray-300 hover:text-gray-600 disabled:opacity-30"
                >
                  ▼
                </button>
              </div>
              <input
                value={item.label}
                onChange={e => rename(item.id, e.target.value)}
                onBlur={commitRename}
                className={`${inputCls} flex-1`}
              />
              <button
                onClick={() => archiveItem(item.id)}
                className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50"
              >
                删除
              </button>
            </li>
          ))}
          {active.length === 0 && <li className="text-xs text-gray-400">模板为空</li>}
        </ul>

        <div className="flex gap-2">
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addItem() }}
            placeholder="新增一项，例如「答辩录屏+转录」"
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={addItem}
            disabled={saving}
            className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 shrink-0"
          >
            添加
          </button>
        </div>

        {archived.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={() => setShowArchived(v => !v)}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              {showArchived ? '▾' : '▸'} 已删除的项 ({archived.length})
            </button>
            {showArchived && (
              <ul className="mt-2 space-y-2">
                {archived.map(item => (
                  <li key={item.id} className="flex items-center gap-2 text-sm text-gray-500">
                    <span className="flex-1 truncate line-through">{item.label}</span>
                    <button
                      onClick={() => restoreItem(item.id)}
                      className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      恢复
                    </button>
                    <button
                      onClick={() => purgeItem(item)}
                      className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
                    >
                      永久删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">提交截止时间</h2>
        <p className="text-xs text-gray-400 mb-3">
          每届两个固定 ddl（都是周五 17:00，相隔一周）。学生按是否延期落在其中一档；留空则该届学生的有效 ddl 显示「待定」。
        </p>

        {rounds.length === 0 ? (
          <p className="text-xs text-gray-400">还没有学期</p>
        ) : (
          <div className="space-y-3">
            {rounds.map(r => {
              const d = deadlines[r] ?? {}
              return (
                <div key={r} className="flex flex-wrap items-center gap-3">
                  <span className="w-16 text-sm text-gray-700 shrink-0">{r}</span>
                  <label className="text-xs text-gray-400 flex items-center gap-1.5">
                    普通
                    <input
                      type="datetime-local"
                      value={d.normal ?? ''}
                      onChange={e => setDeadlines(prev => ({ ...prev, [r]: { ...d, normal: e.target.value || null } }))}
                      className={inputCls}
                    />
                  </label>
                  <label className="text-xs text-gray-400 flex items-center gap-1.5">
                    延期
                    <input
                      type="datetime-local"
                      value={d.extended ?? ''}
                      onChange={e => setDeadlines(prev => ({ ...prev, [r]: { ...d, extended: e.target.value || null } }))}
                      className={inputCls}
                    />
                  </label>
                  <button
                    onClick={() => saveDeadlines(r)}
                    disabled={savingRound === r}
                    className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 shrink-0"
                  >
                    {savingRound === r ? '保存中…' : '保存'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

    </>
  )
}
