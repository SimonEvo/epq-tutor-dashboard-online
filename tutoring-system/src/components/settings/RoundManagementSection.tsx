import { useEffect, useState } from 'react'
import * as dataService from '@/lib/dataService'
import type { ArchivedRound } from '@/lib/dataService'
import type { RoundDeadlines } from '@/types'
import { getToken } from '@/lib/githubClient'
import { useStudentStore } from '@/stores/studentStore'

const dtCls = 'text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white'

interface Props {
  /** 归档掉的学期若正是默认学期，要通知外面清空 */
  onArchived: (name: string) => void
}

/**
 * 学期管理 —— 吃掉了原来的「归档管理」。
 *
 * 一张表，每行一届：两个 ddl + 学生数 + 归档开关 + 展开看学生 / 下载 JSON。
 * 再单开一个 round 编辑界面就会有两处都列 round，必然分叉，所以合并成这一处。
 * 新建 round 的入口不在这里（仍在加学生时 new round，一届一次，频率极低）。
 */
export default function RoundManagementSection({ onArchived }: Props) {
  const rounds = useStudentStore(s => s.rounds)
  const fetchRounds = useStudentStore(s => s.fetchRounds)
  const students = useStudentStore(s => s.students)

  const [archivedRounds, setArchivedRounds] = useState<ArchivedRound[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deadlines, setDeadlines] = useState<Record<string, RoundDeadlines>>({})
  const [savingRound, setSavingRound] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    dataService.getArchivedRounds().then(setArchivedRounds).catch(() => {})
  }, [])

  const allNames = [...rounds, ...archivedRounds.map(a => a.name)]

  useEffect(() => {
    allNames.forEach(name => {
      if (deadlines[name]) return
      dataService.getRoundDeadlines(name)
        .then(d => setDeadlines(prev => ({ ...prev, [name]: d })))
        .catch(() => {})
    })
  }, [allNames.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const archivedByName = new Map(archivedRounds.map(a => [a.name, a]))

  const studentCount = (name: string) =>
    archivedByName.get(name)?.studentCount ?? students.filter(s => s.submissionRound === name).length

  const saveDeadlines = async (name: string) => {
    setSavingRound(name)
    setError('')
    try {
      const saved = await dataService.saveRoundDeadlines(name, deadlines[name] ?? {})
      setDeadlines(prev => ({ ...prev, [name]: saved }))
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingRound(null)
    }
  }

  const toggleArchive = async (name: string, archive: boolean) => {
    if (archive && !confirm(`归档「${name}」？该学期学生将从 Dashboard 隐藏。`)) return
    if (archive) await dataService.archiveRound(name)
    else await dataService.unarchiveRound(name)
    await fetchRounds()
    setArchivedRounds(await dataService.getArchivedRounds())
    if (archive) onArchived(name)
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">学期管理</h2>
      <p className="text-xs text-gray-400 mb-4">
        每届两个固定 ddl（都是周五 17:00，相隔一周），学生按是否延期落在其中一档；留空则该届学生的有效 ddl 显示「待定」。
        归档后的学期不在 Dashboard 显示，展开可查看学生、下载数据。
      </p>

      {error && <div className="mb-3 text-xs text-red-600">{error}</div>}

      {allNames.length === 0 ? (
        <p className="text-xs text-gray-400">暂无学期数据</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* 表头 */}
            <div className="flex items-center gap-3 px-2 pb-2 text-[11px] text-gray-400 border-b border-gray-100">
              <span className="w-16 shrink-0">学期</span>
              <span className="w-44 shrink-0">普通 ddl</span>
              <span className="w-44 shrink-0">延期 ddl</span>
              <span className="w-16 shrink-0" />
              <span className="w-16 shrink-0 text-center">学生数</span>
              <span className="w-12 shrink-0 text-center">归档</span>
              <span className="w-8 shrink-0" />
            </div>

            {allNames.map(name => {
              const archived = archivedByName.get(name)
              const d = deadlines[name] ?? {}
              const isOpen = expanded === name
              return (
                <div key={name} className="border-b border-gray-50 last:border-b-0">
                  <div className={`flex items-center gap-3 px-2 py-2 ${archived ? 'opacity-60' : ''}`}>
                    <span className="w-16 shrink-0 text-sm text-gray-800 truncate">{name}</span>

                    <input
                      type="datetime-local"
                      value={d.normal ?? ''}
                      onChange={e => setDeadlines(prev => ({ ...prev, [name]: { ...d, normal: e.target.value || null } }))}
                      className={`${dtCls} w-44 shrink-0`}
                    />
                    <input
                      type="datetime-local"
                      value={d.extended ?? ''}
                      onChange={e => setDeadlines(prev => ({ ...prev, [name]: { ...d, extended: e.target.value || null } }))}
                      className={`${dtCls} w-44 shrink-0`}
                    />

                    <button
                      type="button"
                      onClick={() => saveDeadlines(name)}
                      disabled={savingRound === name}
                      className="w-16 shrink-0 text-xs px-2 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                      {savingRound === name ? '…' : '保存'}
                    </button>

                    <span className="w-16 shrink-0 text-center text-xs text-gray-500">{studentCount(name)}</span>

                    <span className="w-12 shrink-0 flex justify-center">
                      <input
                        type="checkbox"
                        checked={!!archived}
                        onChange={e => toggleArchive(name, e.target.checked)}
                        className="w-4 h-4 accent-[var(--primary)] cursor-pointer"
                      />
                    </span>

                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : name)}
                      className="w-8 shrink-0 text-xs text-gray-400 hover:text-gray-700"
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="px-2 pb-3">
                      <div className="flex justify-end mb-1.5">
                        <button
                          type="button"
                          onClick={() => dataService.downloadRoundExport(name, getToken() || '')}
                          className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          下载 JSON
                        </button>
                      </div>
                      <div className="divide-y divide-gray-50 border-t border-gray-100">
                        {(archived?.students
                          ?? students.filter(s => s.submissionRound === name).map(s => ({ id: s.id, name: s.name, nameEn: s.nameEn }))
                        ).map(s => (
                          <div key={s.id} className="py-1.5 text-sm text-gray-600">
                            {s.name}{s.nameEn ? ` · ${s.nameEn}` : ''}
                          </div>
                        ))}
                        {studentCount(name) === 0 && (
                          <div className="py-1.5 text-xs text-gray-400">该学期没有学生</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
