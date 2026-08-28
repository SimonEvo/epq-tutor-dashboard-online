import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStudentStore } from '@/stores/studentStore'
import { getChecklistTemplate } from '@/lib/dataService'
import {
  TII_LIMIT, activeTemplateItems, compareForSprint, finalDefenseLabel, formatCountdown,
  formatDeadline, getWrappedOpen, isOverdue, isTicked, pendingCount, setWrappedOpen,
} from '@/lib/submission'
import type { ChecklistCustomItem, ChecklistTemplateItem, Student, TiiCheck } from '@/types'

interface Props {
  students: Student[]
}

// 列宽——表头与行共用，避免两边对不齐
const COL = {
  name: 'w-52',
  ddl: 'w-40',
  defense: 'w-40',
  item: 'w-24',
  custom: 'w-28',
  tii: 'w-32',
  wrap: 'w-20',
}

function newId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const emptyTiiDraft = () => ({
  date: new Date().toISOString().slice(0, 10), ai: '', sim: '', note: '',
})

/** "2026-08-14" → "08.14" */
function shortDate(d?: string): string {
  return d ? d.slice(5).replace('-', '.') : ''
}

/**
 * 「提交」视图 —— 学期末逐个学生核对交付动作。
 * 列 = 答辩确认 + 当前模板项（活定义）+ 表13证据 + Tii + 结项。都在本视图里直接改，走窄端点。
 */
export default function SubmissionSprintView({ students }: Props) {
  const navigate = useNavigate()
  const {
    toggleChecklistItem, setWrappedUp, saveTiiChecks, saveChecklistCustomItems, setDefenseConfirmed,
  } = useStudentStore()
  const [template, setTemplate] = useState<ChecklistTemplateItem[]>([])
  // 已结项分组的展开状态跨视图联动（与提交视图 / 甘特图共用）
  const [showWrapped, setShowWrapped] = useState(getWrappedOpen)
  const toggleWrapped = () => {
    setShowWrapped(v => {
      setWrappedOpen(!v)
      return !v
    })
  }
  const [busy, setBusy] = useState<string | null>(null)

  // Tii 下拉：锚在被点的格子下方（表格容器会横向滚动，用 fixed 定位避免被裁）
  const [tiiPanel, setTiiPanel] = useState<{ id: string; x: number; y: number } | null>(null)
  const [tiiDraft, setTiiDraft] = useState(emptyTiiDraft)

  // 表13证据：快速编辑弹窗
  const [customModalId, setCustomModalId] = useState<string | null>(null)
  const [newCustom, setNewCustom] = useState('')

  useEffect(() => {
    getChecklistTemplate().then(setTemplate).catch(() => setTemplate([]))
  }, [])

  const items = activeTemplateItems(template)
  const sorted = [...students].sort(compareForSprint)
  const active = sorted.filter(s => !s.wrappedUpAt)
  const wrapped = sorted.filter(s => !!s.wrappedUpAt)

  // 弹窗 / 下拉里始终读最新的学生对象
  const tiiStudent = students.find(s => s.id === tiiPanel?.id) ?? null
  const customStudent = students.find(s => s.id === customModalId) ?? null

  // ddl 待定的学期 → 顶部提示条
  const pendingRounds = Array.from(new Set(
    students.filter(s => !s.effectiveDeadline).map(s => s.submissionRound).filter(Boolean),
  )) as string[]

  const handleTick = async (student: Student, itemId: string) => {
    const key = `${student.id}:${itemId}`
    setBusy(key)
    try {
      await toggleChecklistItem(student.id, itemId, !isTicked(student, itemId))
    } catch {
      // 失败已在 store 里回滚
    } finally {
      setBusy(null)
    }
  }

  const handleWrapUp = async (student: Student) => {
    if (student.wrappedUpAt) {
      await setWrappedUp(student.id, false)
      return
    }
    const pending = pendingCount(student, template)
    if (pending > 0 && !confirm(`还有 ${pending} 项未完成，确认结项？`)) return
    await setWrappedUp(student.id, true)
  }

  const openTii = (student: Student, e: React.MouseEvent<HTMLButtonElement>) => {
    if (tiiPanel?.id === student.id) { setTiiPanel(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    setTiiDraft(emptyTiiDraft())
    setTiiPanel({ id: student.id, x: r.left, y: r.bottom + 4 })
  }

  const addTii = async () => {
    if (!tiiStudent || !tiiDraft.date) return
    const next: TiiCheck[] = [...(tiiStudent.tiiChecks ?? []), {
      id: newId(),
      date: tiiDraft.date,
      aiPercent: tiiDraft.ai === '' ? null : Number(tiiDraft.ai),
      similarityPercent: tiiDraft.sim === '' ? null : Number(tiiDraft.sim),
      note: tiiDraft.note,
    }]
    setTiiDraft(emptyTiiDraft())
    await saveTiiChecks(tiiStudent.id, next)
  }

  const removeTii = async (idx: number) => {
    if (!tiiStudent) return
    await saveTiiChecks(tiiStudent.id, (tiiStudent.tiiChecks ?? []).filter((_, i) => i !== idx))
  }

  const saveCustom = async (next: ChecklistCustomItem[]) => {
    if (!customStudent) return
    await saveChecklistCustomItems(customStudent.id, next)
  }

  const addCustom = () => {
    const label = newCustom.trim()
    if (!label || !customStudent) return
    setNewCustom('')
    saveCustom([...(customStudent.submissionChecklist?.customItems ?? []), { id: newId(), label, done: false }])
  }

  const renderRow = (s: Student) => {
    const custom = s.submissionChecklist?.customItems ?? []
    const customDone = custom.filter(c => c.done).length
    const tii = s.tiiChecks ?? []
    const lastTii = tii[tii.length - 1]
    // 结项的人不再催 ddl
    const overdue = !s.wrappedUpAt && isOverdue(s.effectiveDeadline)
    const defenseAt = finalDefenseLabel(s)

    return (
      <div
        key={s.id}
        className={`flex items-center gap-3 px-3 py-2 border-b border-gray-100 hover:bg-gray-50 ${
          s.wrappedUpAt ? 'opacity-60' : ''
        }`}
      >
        {/* 学生：姓名 + 一句话选题 */}
        <button
          onClick={() => navigate(`/students/${s.id}`)}
          className={`${COL.name} shrink-0 text-left group`}
        >
          <div className="text-sm font-medium text-gray-800 truncate group-hover:text-[var(--primary)]">
            {s.name}
            {s.deadlineNeedsConfirm && <span className="ml-1 text-amber-500" title="运营组未确认">⚠</span>}
          </div>
          {s.overview && <div className="text-xs text-gray-400 truncate">{s.overview}</div>}
        </button>

        {/* ddl */}
        <div className={`${COL.ddl} shrink-0`}>
          <div className={`text-xs ${s.effectiveDeadline ? (overdue ? 'text-red-600' : 'text-gray-700') : 'text-amber-600'}`}>
            {formatDeadline(s.effectiveDeadline)}
            {!s.effectiveDeadline && ' ⚠'}
          </div>
          <div className="text-[11px] text-gray-400">
            {s.deadlineTier === 'extended' && <span className="mr-1">延期</span>}
            {s.deadlineOverride && <span className="mr-1">个案</span>}
            {s.wrappedUpAt ? '已结项' : formatCountdown(s.effectiveDeadline)}
          </div>
        </div>

        {/* 答辩确认：日期 + 勾选框 */}
        <label className={`${COL.defense} shrink-0 flex items-center gap-2 cursor-pointer`}>
          <input
            type="checkbox"
            checked={!!s.defenseConfirmed}
            onChange={e => setDefenseConfirmed(s.id, e.target.checked).catch(() => {})}
            className="w-4 h-4 accent-[var(--primary)] cursor-pointer shrink-0"
          />
          <span className={`text-xs truncate ${defenseAt ? 'text-gray-700' : 'text-amber-600'}`}>
            {defenseAt ?? '未确认答辩时间'}
          </span>
        </label>

        {/* 模板项格子 */}
        {items.map(item => {
          const ticked = isTicked(s, item.id)
          const key = `${s.id}:${item.id}`
          return (
            <button
              key={item.id}
              title={item.label}
              disabled={busy === key}
              onClick={() => handleTick(s, item.id)}
              className={`${COL.item} shrink-0 h-8 rounded border text-sm transition-colors ${
                ticked
                  ? 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-white border-gray-200 text-gray-300 hover:border-gray-400'
              } ${busy === key ? 'opacity-50' : ''}`}
            >
              {ticked ? '✓' : '·'}
            </button>
          )
        })}

        {/* 表13证据 → 快速编辑弹窗 */}
        <button
          onClick={() => { setCustomModalId(s.id); setNewCustom('') }}
          title="快速编辑表13证据"
          className={`${COL.custom} shrink-0 text-xs text-gray-500 hover:text-gray-800 text-center`}
        >
          {customDone}/{custom.length} ✎
        </button>

        {/* Tii → 下拉 */}
        <button
          onClick={e => openTii(s, e)}
          title="查看 / 添加论文检测记录"
          className={`${COL.tii} shrink-0 text-xs text-left ${
            tii.length >= TII_LIMIT ? 'text-red-600 font-medium' : 'text-gray-500'
          } hover:underline`}
        >
          {tii.length}/{TII_LIMIT}
          {lastTii?.aiPercent != null && <span className="ml-1">AI {lastTii.aiPercent}%</span>}
          <span className="ml-1 text-gray-300">▾</span>
        </button>

        {/* 结项 */}
        <div className={`${COL.wrap} shrink-0 text-right`}>
          <button
            onClick={() => handleWrapUp(s)}
            className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-gray-400"
          >
            {s.wrappedUpAt ? '取消' : '结项'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <div className="min-w-max">
          {pendingRounds.length > 0 && (
            <div className="flex bg-amber-50 border-b border-amber-200">
              <div className="sticky left-0 px-3 py-2 bg-amber-50 text-xs text-amber-800">
                {pendingRounds.join(' / ')} 尚未设置提交截止时间，
                <Link to="/settings" className="underline">去设置 →</Link>
              </div>
            </div>
          )}

          {/* 表头 */}
          <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs text-gray-400">
            <span className={`${COL.name} shrink-0`}>学生</span>
            <span className={`${COL.ddl} shrink-0`}>ddl</span>
            <span className={`${COL.defense} shrink-0`}>答辩确认</span>
            {items.map(i => (
              <span key={i.id} className={`${COL.item} shrink-0 text-center truncate`} title={i.label}>
                {i.label}
              </span>
            ))}
            <span className={`${COL.custom} shrink-0 text-center`}>表13证据</span>
            <span className={`${COL.tii} shrink-0`}>Tii</span>
            <span className={`${COL.wrap} shrink-0 text-right`}>结项</span>
          </div>

          {active.map(renderRow)}

          {active.length === 0 && wrapped.length === 0 && (
            <div className="py-12 text-center text-gray-400 text-sm">没有学生</div>
          )}

          {wrapped.length > 0 && (
            <>
              <div
                className="flex bg-gray-50 border-t border-gray-200 cursor-pointer select-none"
                onClick={toggleWrapped}
              >
                <div className="sticky left-0 flex items-center gap-2 px-3 py-2 bg-gray-50">
                  <span className="text-xs text-gray-500">{showWrapped ? '▾' : '▸'}</span>
                  <span className="text-xs text-gray-500">已结项 ({wrapped.length})</span>
                </div>
              </div>
              {showWrapped && wrapped.map(renderRow)}
            </>
          )}
        </div>
      </div>

      {/* ── Tii 下拉 ─────────────────────────────────────────────────────── */}
      {tiiPanel && tiiStudent && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTiiPanel(null)} />
          <div
            className="fixed z-50 w-96 bg-white border border-gray-200 rounded-xl shadow-lg p-3"
            style={{ left: Math.min(tiiPanel.x, window.innerWidth - 400), top: tiiPanel.y }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-700">{tiiStudent.name} · 论文检测记录</span>
              <span className={`text-xs ${(tiiStudent.tiiChecks ?? []).length >= TII_LIMIT ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                {(tiiStudent.tiiChecks ?? []).length}/{TII_LIMIT}
              </span>
              <button onClick={() => setTiiPanel(null)} className="ml-auto text-gray-300 hover:text-gray-600">×</button>
            </div>

            {(tiiStudent.tiiChecks ?? []).length === 0 ? (
              <p className="text-xs text-gray-400 mb-2">还没有检测记录</p>
            ) : (
              <ul className="space-y-1 mb-2">
                {(tiiStudent.tiiChecks ?? []).map((t, i) => (
                  <li key={t.id ?? i} className="flex items-center gap-2 text-xs text-gray-600">
                    <span className="text-gray-400">{shortDate(t.date)}</span>
                    <span>AI {t.aiPercent ?? '—'}%</span>
                    <span>相似度 {t.similarityPercent ?? '—'}%</span>
                    {t.note && <span className="text-gray-400 truncate">{t.note}</span>}
                    <button onClick={() => removeTii(i)} className="ml-auto text-gray-300 hover:text-red-500">×</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-1.5 items-center border-t border-gray-100 pt-2">
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
                className="w-16 text-xs border border-gray-200 rounded px-2 py-1"
              />
              <input
                type="number"
                value={tiiDraft.sim}
                onChange={e => setTiiDraft({ ...tiiDraft, sim: e.target.value })}
                placeholder="相似度 %"
                className="w-20 text-xs border border-gray-200 rounded px-2 py-1"
              />
              <input
                value={tiiDraft.note}
                onChange={e => setTiiDraft({ ...tiiDraft, note: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') addTii() }}
                placeholder="备注"
                className="flex-1 min-w-16 text-xs border border-gray-200 rounded px-2 py-1"
              />
              <button
                onClick={addTii}
                className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:border-gray-400"
              >
                添加
              </button>
            </div>
            <p className="text-[11px] text-gray-300 mt-1.5">AI 率 / 相似度可留空</p>
          </div>
        </>
      )}

      {/* ── 表13证据 快速编辑 ────────────────────────────────────────────── */}
      {customStudent && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setCustomModalId(null)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-md p-4 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center mb-3">
              <h3 className="text-sm font-medium text-gray-900">{customStudent.name} · 表13证据</h3>
              <button onClick={() => setCustomModalId(null)} className="ml-auto text-gray-300 hover:text-gray-600">×</button>
            </div>

            {(customStudent.submissionChecklist?.customItems ?? []).length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">还没有条目</p>
            ) : (
              <ul className="mb-3 divide-y divide-gray-100">
                {(customStudent.submissionChecklist?.customItems ?? []).map(c => (
                  <li key={c.id} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={() => saveCustom((customStudent.submissionChecklist?.customItems ?? []).map(x => (
                        x.id === c.id
                          ? { ...x, done: !x.done, doneAt: !x.done ? new Date().toISOString() : undefined }
                          : x
                      )))}
                      className="w-5 h-5 accent-[var(--primary)] cursor-pointer shrink-0"
                    />
                    <span className={`text-sm flex-1 ${c.done ? 'text-green-700 line-through' : 'text-gray-700'}`}>
                      {c.label}
                    </span>
                    {c.fixed ? (
                      <span className="text-[11px] text-gray-300 px-1" title="所有学生共有的固定项，不可删">固定</span>
                    ) : (
                      <button
                        onClick={() => saveCustom((customStudent.submissionChecklist?.customItems ?? []).filter(x => x.id !== c.id))}
                        className="text-gray-300 hover:text-red-500 text-lg leading-none px-1"
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
                autoFocus
                value={newCustom}
                onChange={e => setNewCustom(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
                placeholder="加一项…"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
              <button
                onClick={addCustom}
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
