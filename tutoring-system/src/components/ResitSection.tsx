import { useEffect, useState } from 'react'
import * as dataService from '@/lib/dataService'
import { useStudentStore } from '@/stores/studentStore'
import { formatDeadline } from '@/lib/submission'
import { isResit } from '@/lib/formatters'
import { EPQ_MILESTONES } from '@/config'
import type { PreviousAttempt, Student } from '@/types'

interface Props {
  student: Student
  /** resit 开始 / 撤销后服务端返回整个学生，详情页直接替换 */
  onReplace: (student: Student) => void
}

// 轮次标签 `25秋` / `26春`（以开课学期命名，见 CONTEXT.md）。
// 只用于 resit 弹窗的默认值和提示文案，识别不了就留空让人自己选。
const ROUND_RE = /(\d{2})\s*(春|秋)/

/** 下一轮：春 → 同年秋；秋 → 次年春 */
function nextRound(label?: string | null): string | null {
  const m = label ? ROUND_RE.exec(label) : null
  if (!m) return null
  const yy = Number(m[1])
  return m[2] === '春' ? `${m[1]}秋` : `${String((yy + 1) % 100).padStart(2, '0')}春`
}

/** `25秋` → `26年3月提交` */
function submissionHint(label?: string | null): string {
  const m = label ? ROUND_RE.exec(label) : null
  if (!m) return ''
  const yy = Number(m[1])
  return m[2] === '春' ? `${m[1]}年8月提交` : `${String((yy + 1) % 100).padStart(2, '0')}年3月提交`
}

const MILESTONE_LABEL: Record<string, string> = Object.fromEntries(EPQ_MILESTONES.map(m => [m.id, m.label]))
const STATUS_LABEL: Record<string, string> = { not_started: '未开始', in_progress: '进行中', completed: '完成', na: 'N/A' }

/**
 * Resit（二次提交）—— 见 docs/adr/0007。
 * 开始 resit = 当前这次提交存成只读快照，学生在新轮次从头来（ddl / 清单 / Tii / 里程碑 / SA 额度）。
 */
export default function ResitSection({ student, onReplace }: Props) {
  const { rounds, fetchAll, fetchRounds } = useStudentStore()
  const [open, setOpen] = useState(false)
  const [round, setRound] = useState('')
  const [hours, setHours] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  // 直接打开详情页时 store 里还没有轮次表
  useEffect(() => {
    if (rounds.length === 0) fetchRounds().catch(() => {})
  }, [rounds.length, fetchRounds])

  const previous = student.previousAttempts ?? []
  // 下拉里必须有建议值：下一轮可能还没在轮次表里建出来
  const suggested = nextRound(student.submissionRound) ?? ''
  const options = Array.from(new Set([suggested, ...rounds].filter(Boolean)))
    .filter(r => r !== student.submissionRound)

  const openDialog = () => {
    setRound(suggested)
    setHours('')
    setError('')
    setOpen(true)
  }

  const run = async (fn: () => Promise<Student>) => {
    setBusy(true)
    setError('')
    try {
      onReplace(await fn())
      setOpen(false)
      fetchAll().catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const start = () => {
    const n = Number(hours)
    if (!round) { setError('请选择 resit 轮次'); return }
    if (hours.trim() === '' || !Number.isInteger(n) || n < 0) { setError('课时包请填非负整数'); return }
    run(() => dataService.startResit(student.id, round, n))
  }

  const undo = () => {
    const last = previous[previous.length - 1]
    if (!confirm(
      `撤销 Resit，学生回到 ${last?.submissionRound ?? '上一轮'}？\n\n` +
      '第一次提交的 ddl / 清单 / Tii / 里程碑 / 课时额度会原样恢复；\n' +
      'resit 期间新记的这些内容会被丢弃，resit 期间的课并回第一次提交。',
    )) return
    run(() => dataService.undoResit(student.id))
  }

  return (
    <>
      {isResit(student) ? (
        <div className="bg-white rounded-xl border border-purple-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium text-gray-900 text-sm">
              Resit · 第 {student.currentAttempt} 次提交
              <span className="ml-2 text-xs font-normal text-gray-400">
                {student.submissionRound} {submissionHint(student.submissionRound)}
              </span>
            </h2>
            <button
              onClick={undo}
              disabled={busy}
              className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
            >
              撤销 Resit
            </button>
          </div>
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          <div className="flex flex-col gap-1.5">
            {previous.map(a => (
              <AttemptSnapshot
                key={a.attempt}
                attempt={a}
                open={expanded === a.attempt}
                onToggle={() => setExpanded(v => (v === a.attempt ? null : a.attempt))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex justify-end -mt-3 mb-5">
          <button onClick={openDialog} className="text-xs text-gray-400 hover:text-purple-600">
            学生要 resit？开始 Resit →
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-1">开始 Resit</h2>
            <p className="text-xs text-gray-500 mb-4">
              {student.name} 在 {student.submissionRound || '当前轮次'} 的这次提交会存档（只读），
              ddl、提交清单、Tii、里程碑、结项、SA 课时在新一轮从头开始。已上的课保留在课程记录里，但不再计入新的课时额度。
            </p>

            <label className="block text-xs text-gray-500 mb-1">Resit 轮次</label>
            <select
              value={round}
              onChange={e => setRound(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-1"
            >
              {options.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mb-3">{submissionHint(round)}</p>

            <label className="block text-xs text-gray-500 mb-1">Resit 课时包（SA 节数）</label>
            <input
              type="number"
              min={0}
              value={hours}
              onChange={e => setHours(e.target.value)}
              placeholder="例如 4"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-3"
            />

            {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400"
              >
                取消
              </button>
              <button
                onClick={start}
                disabled={busy}
                className="text-sm px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {busy ? '处理中…' : '开始 Resit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function AttemptSnapshot({ attempt: a, open, onToggle }: {
  attempt: PreviousAttempt
  open: boolean
  onToggle: () => void
}) {
  const ticked = Object.keys(a.submissionChecklist?.ticked ?? {}).length
  const custom = a.submissionChecklist?.customItems ?? []
  const milestones = Object.entries(a.milestones ?? {})

  return (
    <div className="border border-gray-100 rounded-lg">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-xs text-gray-400">{open ? '▾' : '▸'}</span>
        <span className="text-sm text-gray-700">第 {a.attempt} 次提交 · {a.submissionRound || '未填轮次'}</span>
        <span className="ml-auto text-xs text-gray-400">
          SA {a.saHoursUsed}/{a.saHoursTotal} · Tii {a.tiiChecks?.length ?? 0} 次
          {a.wrappedUpAt && ` · ${a.wrappedUpAt.slice(0, 10)} 结项`}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 text-xs text-gray-600 flex flex-col gap-2">
          <div>
            <span className="text-gray-400">ddl：</span>
            {a.deadlineOverride ? `个案 ${formatDeadline(a.deadlineOverride)}` : a.deadlineTier === 'extended' ? '延期一周' : '正常'}
            {a.defenseConfirmed && <span className="ml-2">· 答辩已确认</span>}
          </div>
          <div>
            <span className="text-gray-400">提交清单：</span>已勾 {ticked} 项 ·
            表13证据 {custom.filter(c => c.done).length}/{custom.length}
          </div>
          {(a.tiiChecks?.length ?? 0) > 0 && (
            <div>
              <span className="text-gray-400">Tii：</span>
              {a.tiiChecks.map((t, i) => (
                <span key={i} className="mr-3">
                  {t.date}
                  {t.aiPercent != null && ` AI ${t.aiPercent}%`}
                  {t.similarityPercent != null && ` 相似 ${t.similarityPercent}%`}
                </span>
              ))}
            </div>
          )}
          {milestones.length > 0 && (
            <div>
              <span className="text-gray-400">里程碑：</span>
              {milestones.map(([id, st]) => (
                <span key={id} className="mr-3">{MILESTONE_LABEL[id] ?? id} {STATUS_LABEL[st] ?? st}</span>
              ))}
            </div>
          )}
          <div className="text-gray-400">存档于 {a.closedAt.slice(0, 10)}</div>
        </div>
      )}
    </div>
  )
}
