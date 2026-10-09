import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  parseSheet, readWorkbook, sheetNames,
  type ImportRow, type ParseResult,
} from '@/lib/studentExcelParser'
import {
  applyStudentImport, previewStudentImport,
  type ImportPreviewResult, type ImportPreviewRow,
} from '@/lib/dataService'
import { useStudentStore } from '@/stores/studentStore'
import type * as XLSX from 'xlsx'

type Action = 'create' | 'update' | 'skip'

const CATEGORY_LABEL: Record<ImportPreviewRow['category'], string> = {
  new: '新建', update: '更新', conflict: '需确认',
}
const CATEGORY_CLS: Record<ImportPreviewRow['category'], string> = {
  new: 'bg-green-50 text-green-700 border-green-200',
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  conflict: 'bg-amber-50 text-amber-700 border-amber-200',
}

/** 默认动作：冲突行一律默认跳过，逼人工看一眼；无变化的更新行也没必要写库。 */
function defaultAction(row: ImportPreviewRow): Action {
  if (row.category === 'conflict') return 'skip'
  if (row.category === 'update') return row.diffs.length ? 'update' : 'skip'
  return 'create'
}

export default function ImportStudentsPage() {
  const navigate = useNavigate()
  const fetchAll = useStudentStore(s => s.fetchAll)

  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [sheet, setSheet] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [actions, setActions] = useState<Record<number, Action>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ created: number; updated: number; skipped: number } | null>(null)

  const reset = () => {
    setParsed(null); setPreview(null); setActions({}); setError(''); setDone(null)
  }

  const handleFile = async (file: File) => {
    reset()
    setWorkbook(null); setSheets([]); setSheet('')
    setBusy(true)
    try {
      const wb = await readWorkbook(file)
      const names = sheetNames(wb)
      setWorkbook(wb); setSheets(names)
      if (names.length === 1) {
        setSheet(names[0])
        setParsed(parseSheet(wb, names[0]))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '文件读取失败')
    } finally {
      setBusy(false)
    }
  }

  const chooseSheet = (name: string) => {
    if (!workbook) return
    reset()
    setSheet(name)
    setParsed(parseSheet(workbook, name))
  }

  const runPreview = async () => {
    if (!parsed?.rows.length) return
    setBusy(true); setError('')
    try {
      const result = await previewStudentImport(parsed.rows)
      setPreview(result)
      const next: Record<number, Action> = {}
      result.rows.forEach(r => { next[r.rowIndex] = defaultAction(r) })
      setActions(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败')
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c = { create: 0, update: 0, skip: 0 }
    Object.values(actions).forEach(a => { c[a] += 1 })
    return c
  }, [actions])

  const runApply = async () => {
    if (!preview) return
    setBusy(true); setError('')
    try {
      const payload = preview.rows.map(r => ({
        action: actions[r.rowIndex] ?? 'skip',
        studentId: r.matchedStudentId,
        data: r.data as ImportRow,
      }))
      const result = await applyStudentImport(payload)
      setDone(result)
      await fetchAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">导入学生</h1>
        <button onClick={() => navigate('/')}
          className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
          返回
        </button>
      </div>

      {/* ── 1. 选文件 ── */}
      <section className="bg-white rounded-2xl border border-[var(--border)] p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">1 · 选择 Excel 文件</h2>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg
                     file:border file:border-gray-200 file:text-sm file:bg-gray-50 hover:file:bg-gray-100"
        />
        <p className="mt-2 text-xs text-gray-500">
          表头自动识别，列的顺序无所谓。识别「姓名」「学校」「报名学期」「班期」「督导」等常见列名，
          教务系统导出的表可以直接用。
        </p>

        {sheets.length > 1 && (
          <div className="mt-4">
            <label className="block text-xs text-gray-500 mb-1">工作表</label>
            <select value={sheet} onChange={e => chooseSheet(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— 选择 —</option>
              {sheets.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
      </section>

      {/* ── 2. 解析结果 ── */}
      {parsed && (
        <section className="bg-white rounded-2xl border border-[var(--border)] p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">2 · 解析结果</h2>
          <p className="text-sm text-gray-700">
            读到 <span className="font-semibold">{parsed.rows.length}</span> 行；
            识别到 {parsed.matchedColumns.length} 个字段列。
          </p>
          {parsed.matchedColumns.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {parsed.matchedColumns.map(c => (
                <span key={c} className="text-xs px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-600">{c}</span>
              ))}
            </div>
          )}
          {parsed.warnings.length > 0 && (
            <ul className="mt-3 text-xs text-amber-700 list-disc list-inside space-y-1">
              {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <button
            onClick={runPreview}
            disabled={busy || !parsed.rows.length}
            className="mt-4 bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg
                       hover:bg-[var(--primary-hover)] disabled:opacity-40"
          >
            {busy ? '比对中…' : '与现有学生比对'}
          </button>
        </section>
      )}

      {/* ── 3. 逐行确认 ── */}
      {preview && !done && (
        <section className="bg-white rounded-2xl border border-[var(--border)] p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">3 · 确认每一行</h2>
          <p className="text-xs text-gray-500 mb-4">
            新建 {preview.summary.new} · 更新 {preview.summary.update}
            （其中 {preview.summary.unchanged} 行无变化）· 需确认 {preview.summary.conflict}。
            空单元格不会覆盖已有内容。
          </p>

          <div className="space-y-2">
            {preview.rows.map(row => (
              <div key={row.rowIndex} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded border ${CATEGORY_CLS[row.category]}`}>
                      {CATEGORY_LABEL[row.category]}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">{row.name || '（无姓名）'}</span>
                    {row.matchedStudentName && row.matchedStudentName !== row.name && (
                      <span className="text-xs text-gray-400">↔ {row.matchedStudentName}</span>
                    )}
                  </div>
                  <select
                    value={actions[row.rowIndex] ?? 'skip'}
                    onChange={e => setActions({ ...actions, [row.rowIndex]: e.target.value as Action })}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-xs shrink-0"
                  >
                    <option value="skip">跳过</option>
                    {row.category !== 'update' && <option value="create">新建</option>}
                    {row.matchedStudentId && <option value="update">更新</option>}
                  </select>
                </div>

                {row.reason && <p className="mt-2 text-xs text-amber-700">{row.reason}</p>}
                {row.supervisorWarning && <p className="mt-1 text-xs text-amber-700">{row.supervisorWarning}</p>}

                {row.category === 'update' && (
                  row.diffs.length ? (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {row.diffs.map(d => (
                          <tr key={d.field} className="border-t border-gray-50">
                            <td className="py-1 pr-3 text-gray-500 w-24">{d.label}</td>
                            <td className="py-1 pr-2 text-gray-400 line-through break-all">{d.before || '（空）'}</td>
                            <td className="py-1 text-gray-900 break-all">{d.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="mt-2 text-xs text-gray-400">与现有数据一致，无需更新</p>
                )}

                {row.category === 'new' && (
                  <p className="mt-2 text-xs text-gray-500">
                    {[row.data.school, row.data.registrationRound && `报名 ${row.data.registrationRound}`,
                      row.data.submissionRound && `提交 ${row.data.submissionRound}`,
                      row.data.isOneYear && '一年期']
                      .filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={runApply}
              disabled={busy || counts.create + counts.update === 0}
              className="bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg
                         hover:bg-[var(--primary-hover)] disabled:opacity-40"
            >
              {busy ? '导入中…' : `确认导入（新建 ${counts.create} · 更新 ${counts.update}）`}
            </button>
            <span className="text-xs text-gray-500">跳过 {counts.skip} 行</span>
          </div>
        </section>
      )}

      {/* ── 4. 结果 ── */}
      {done && (
        <section className="bg-white rounded-2xl border border-[var(--border)] p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">导入完成</h2>
          <p className="text-sm text-gray-700">
            新建 {done.created} 名 · 更新 {done.updated} 名 · 跳过 {done.skipped} 行。
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => navigate('/')}
              className="bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg hover:bg-[var(--primary-hover)]">
              回到概览
            </button>
            <button onClick={() => { reset(); setWorkbook(null); setSheets([]); setSheet('') }}
              className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
              再导一批
            </button>
          </div>
        </section>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  )
}
