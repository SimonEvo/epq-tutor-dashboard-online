import { useEffect, useState } from 'react'
import * as dataService from '@/lib/dataService'
import { useStudentStore } from '@/stores/studentStore'
import {
  TII_LIMIT, activeTemplateItems, formatCountdown, formatDeadline, isTicked, pendingCount,
} from '@/lib/submission'
import type { ChecklistCustomItem, ChecklistTemplateItem, Student, TiiCheck } from '@/types'

interface Props {
  student: Student
  onChange: (patch: Partial<Student>) => void
}

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 学生详情页「提交」卡片 —— 逐个操作（批量扫描在 Dashboard 的「提交」视图）。
 * 全部走窄端点，绝不触发全量学生保存。
 */
export default function SubmissionCard({ student, onChange }: Props) {
  const patchLocalStudent = useStudentStore(s => s.patchLocalStudent)
  const [template, setTemplate] = useState<ChecklistTemplateItem[]>([])
  const [newCustom, setNewCustom] = useState('')
  const [tiiDraft, setTiiDraft] = useState({ date: new Date().toISOString().slice(0, 10), ai: '', sim: '', note: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    dataService.getChecklistTemplate().then(setTemplate).catch(() => setTemplate([]))
  }, [])

  /** 同步到详情页本地 state 与 Dashboard store */
  const apply = (patch: Partial<Student>) => {
    onChange(patch)
    patchLocalStudent(student.id, patch)
  }

  const guard = async (fn: () => Promise<void>) => {
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    }
  }

  const items = activeTemplateItems(template)
  const checklist = student.submissionChecklist ?? { ticked: {}, customItems: [] }
  const custom = checklist.customItems ?? []
  const tiiChecks = student.tiiChecks ?? []
  const tiiOver = tiiChecks.length >= TII_LIMIT

  const pending = pendingCount(student, template)

  const toggleTick = (itemId: string) => guard(async () => {
    const saved = await dataService.patchChecklistTick(student.id, itemId, !isTicked(student, itemId))
    apply({ submissionChecklist: saved })
  })

  const saveCustom = (next: ChecklistCustomItem[]) => guard(async () => {
    const saved = await dataService.patchChecklistCustomItems(student.id, next)
    apply({ submissionChecklist: saved })
  })

  const addCustom = () => {
    const label = newCustom.trim()
    if (!label) return
    setNewCustom('')
    saveCustom([...custom, { id: newId(), label, done: false }])
  }

  const toggleCustom = (item: ChecklistCustomItem) => {
    saveCustom(custom.map(c => (
      c.id === item.id
        ? { ...c, done: !c.done, doneAt: !c.done ? new Date().toISOString() : undefined }
        : c
    )))
  }

  const patchDeadline = (body: { tier?: 'normal' | 'extended'; override?: string | null; confirmed?: boolean }) =>
    guard(async () => {
      const saved = await dataService.patchStudentDeadline(student.id, body)
      apply(saved)
    })

  const saveTii = (next: TiiCheck[]) => guard(async () => {
    const saved = await dataService.patchTiiChecks(student.id, next)
    apply({ tiiChecks: saved })
  })

  const addTii = () => {
    if (!tiiDraft.date) return
    saveTii([...tiiChecks, {
      id: newId(),
      date: tiiDraft.date,
      aiPercent: tiiDraft.ai === '' ? null : Number(tiiDraft.ai),
      similarityPercent: tiiDraft.sim === '' ? null : Number(tiiDraft.sim),
      note: tiiDraft.note,
    }])
    setTiiDraft({ date: new Date().toISOString().slice(0, 10), ai: '', sim: '', note: '' })
  }

  const wrapUp = () => guard(async () => {
    if (student.wrappedUpAt) {
      apply({ wrappedUpAt: await dataService.patchStudentWrapUp(student.id, false) })
      return
    }
    if (pending > 0 && !confirm(`还有 ${pending} 项未完成，确认结项？`)) return
    apply({ wrappedUpAt: await dataService.patchStudentWrapUp(student.id, true) })
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium text-gray-900 text-sm">提交</h2>
        <button
          onClick={wrapUp}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            student.wrappedUpAt
              ? 'bg-green-50 border-green-300 text-green-700'
              : 'border-gray-200 text-gray-600 hover:border-gray-400'
          }`}
        >
          {student.wrappedUpAt ? `已结项 · 取消结项` : '结项'}
        </button>
      </div>

      {error && <div className="mb-3 text-xs text-red-600">{error}</div>}

      {/* ── 截止时间 ─────────────────────────────────────────────────────── */}
      <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-xs text-gray-400">有效 ddl</span>
          <span className="text-sm font-medium text-gray-800">{formatDeadline(student.effectiveDeadline)}</span>
          <span className="text-xs text-gray-400">{formatCountdown(student.effectiveDeadline)}</span>
          {student.deadlineNeedsConfirm && (
            <span className="text-xs text-amber-600">⚠ 运营组未确认</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={student.deadlineTier === 'extended'}
              onChange={e => patchDeadline({ tier: e.target.checked ? 'extended' : 'normal' })}
            />
            延期一周
          </label>

          <label className="flex items-center gap-1.5">
            手动覆盖
            <input
              type="datetime-local"
              value={student.deadlineOverride ?? ''}
              onChange={e => patchDeadline({ override: e.target.value || null })}
              className="border border-gray-200 rounded px-2 py-1"
            />
            {student.deadlineOverride && (
              <button
                onClick={() => patchDeadline({ override: null })}
                className="text-gray-400 hover:text-gray-700"
              >
                清除
              </button>
            )}
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!student.deadlineChangeConfirmed}
              onChange={e => patchDeadline({ confirmed: e.target.checked })}
            />
            运营组已确认
          </label>
        </div>
      </div>

      {/* ── 模板项 ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {items.length === 0 && <span className="text-xs text-gray-400">模板为空 —— 去设置页添加</span>}
        {items.map(item => {
          const ticked = isTicked(student, item.id)
          return (
            <button
              key={item.id}
              onClick={() => toggleTick(item.id)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                ticked
                  ? 'bg-green-100 text-green-700 border-green-300'
                  : 'bg-gray-100 text-gray-400 border-gray-200'
              }`}
            >
              {ticked ? '●' : '○'} {item.label}
            </button>
          )
        })}
      </div>

      {/* ── 表13证据 ─────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="text-xs text-gray-400 mb-1.5">表13证据</div>
        {custom.length > 0 && (
          <ul className="space-y-1 mb-2">
            {custom.map(c => (
              <li key={c.id} className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => toggleCustom(c)}
                  className={c.done ? 'text-green-600' : 'text-gray-300'}
                >
                  {c.done ? '●' : '○'}
                </button>
                <span className={c.done ? 'text-green-700 line-through' : 'text-gray-700'}>{c.label}</span>
                {c.fixed ? (
                  <span className="ml-auto text-[11px] text-gray-300" title="所有学生共有的固定项，不可删">固定</span>
                ) : (
                  <button
                    onClick={() => saveCustom(custom.filter(x => x.id !== c.id))}
                    className="ml-auto text-gray-300 hover:text-red-500"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            value={newCustom}
            onChange={e => setNewCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
            placeholder="加一项…"
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
          />
          <button onClick={addCustom} className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:border-gray-400">
            添加
          </button>
        </div>
      </div>

      {/* ── Tii 检测记录 ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs text-gray-400">论文检测记录</span>
          <span className={`text-xs ${tiiOver ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
            {tiiChecks.length}/{TII_LIMIT}
          </span>
          {tiiOver && <span className="text-xs text-red-600">已达检测次数上限</span>}
        </div>

        {tiiChecks.length > 0 && (
          <ul className="space-y-1 mb-2">
            {tiiChecks.map((t, i) => (
              <li key={t.id ?? i} className="flex items-center gap-3 text-xs text-gray-600">
                <span className="text-gray-400">{t.date}</span>
                <span>AI {t.aiPercent ?? '—'}%</span>
                <span>相似度 {t.similarityPercent ?? '—'}%</span>
                {t.note && <span className="text-gray-400 truncate">{t.note}</span>}
                <button
                  onClick={() => saveTii(tiiChecks.filter((_, j) => j !== i))}
                  className="ml-auto text-gray-300 hover:text-red-500"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            value={tiiDraft.date}
            onChange={e => setTiiDraft({ ...tiiDraft, date: e.target.value })}
            className="text-xs border border-gray-200 rounded px-2 py-1"
          />
          <input
            type="number"
            value={tiiDraft.ai}
            onChange={e => setTiiDraft({ ...tiiDraft, ai: e.target.value })}
            placeholder="AI %"
            className="w-20 text-xs border border-gray-200 rounded px-2 py-1"
          />
          <input
            type="number"
            value={tiiDraft.sim}
            onChange={e => setTiiDraft({ ...tiiDraft, sim: e.target.value })}
            placeholder="相似度 %"
            className="w-24 text-xs border border-gray-200 rounded px-2 py-1"
          />
          <input
            value={tiiDraft.note}
            onChange={e => setTiiDraft({ ...tiiDraft, note: e.target.value })}
            placeholder="备注"
            className="flex-1 min-w-24 text-xs border border-gray-200 rounded px-2 py-1"
          />
          <button onClick={addTii} className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:border-gray-400">
            添加
          </button>
        </div>
        <p className="text-xs text-gray-300 mt-2">AI 率 / 相似度可留空</p>
      </div>
    </div>
  )
}
