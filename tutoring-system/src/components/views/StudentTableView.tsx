import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Student } from '@/types'
import { EPQ_MILESTONES } from '@/config'
import { formatHours, isSessionStarted } from '@/lib/formatters'

interface Props {
  students: Student[]
}

type SortCol = 'name' | 'submissionRound' | 'saHours' | 'milestone' | 'lastSession' | 'nextSession'
type SortDir = 'asc' | 'desc'

const SESSION_LABEL: Record<string, string> = {
  SA_MEETING: 'SA',
  TA_MEETING: 'TA',
  THEORY: 'Theory',
}

function getMilestoneProgress(s: Student) {
  const applicable = EPQ_MILESTONES.filter(m => !m.optional || s.milestones[m.id] !== 'na')
  const completed = applicable.filter(m => s.milestones[m.id] === 'completed').length
  return applicable.length > 0 ? Math.round((completed / applicable.length) * 100) : 0
}

function getSaHoursUsed(s: Student) {
  return s.sessions
    .filter(x => x.type === 'SA_MEETING' && isSessionStarted(x))
    .reduce((sum, x) => sum + x.durationMinutes / 60, 0)
}

function getLastMeeting(s: Student) {
  return [...s.sessions]
    .filter(x => (x.type === 'SA_MEETING' || x.type === 'TA_MEETING') && isSessionStarted(x))
    .sort((a, b) => b.date.localeCompare(a.date))[0]
}

function getNextSession(s: Student) {
  return [...s.sessions]
    .filter(x => !isSessionStarted(x))
    .sort((a, b) => a.date.localeCompare(b.date))[0]
}

function urgencyBorder(s: Student) {
  const last = getLastMeeting(s)
  if (!last) return 'border-l-gray-200'
  const days = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000)
  return days > 14 ? 'border-l-red-400' : days > 7 ? 'border-l-amber-400' : 'border-l-green-400'
}

export default function StudentTableView({ students }: Props) {
  const navigate = useNavigate()
  const [sortCol, setSortCol] = useState<SortCol>('lastSession')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const sorted = [...students].sort((a, b) => {
    let cmp = 0
    if (sortCol === 'name') cmp = a.name.localeCompare(b.name)
    else if (sortCol === 'submissionRound') cmp = (a.submissionRound ?? '').localeCompare(b.submissionRound ?? '')
    else if (sortCol === 'saHours') cmp = getSaHoursUsed(a) - getSaHoursUsed(b)
    else if (sortCol === 'milestone') cmp = getMilestoneProgress(a) - getMilestoneProgress(b)
    else if (sortCol === 'lastSession') cmp = (getLastMeeting(a)?.date ?? '').localeCompare(getLastMeeting(b)?.date ?? '')
    else if (sortCol === 'nextSession') cmp = (getNextSession(a)?.date ?? 'zzzz').localeCompare(getNextSession(b)?.date ?? 'zzzz')
    return sortDir === 'asc' ? cmp : -cmp
  })

  const SortTh = ({ col, label }: { col: SortCol; label: string }) => (
    <th
      className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 cursor-pointer select-none hover:text-gray-800 whitespace-nowrap"
      onClick={() => handleSort(col)}
    >
      {label}{sortCol === col && <span className="ml-1 text-gray-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <SortTh col="name" label="姓名" />
            <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">选题</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">标签</th>
            <SortTh col="submissionRound" label="批次" />
            <SortTh col="saHours" label="SA课时" />
            <SortTh col="milestone" label="里程碑" />
            <SortTh col="lastSession" label="最近课时" />
            <SortTh col="nextSession" label="下次课时" />
            <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">备注</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map(student => {
            const saUsed = getSaHoursUsed(student)
            const saRemaining = student.saHoursTotal - saUsed
            const saLow = saRemaining <= 2
            const progress = getMilestoneProgress(student)
            const last = getLastMeeting(student)
            const daysSince = last ? Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000) : null
            const next = getNextSession(student)

            return (
              <tr
                key={student.id}
                className="hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/students/${student.id}`)}
              >
                <td className={`px-3 py-3 border-l-4 ${urgencyBorder(student)}`}>
                  <p className="font-medium text-gray-900 whitespace-nowrap">{student.name}</p>
                  {student.nameEn && <p className="text-xs text-gray-400">{student.nameEn}</p>}
                </td>
                <td className="px-3 py-3 max-w-[180px]">
                  {student.overview && <p className="text-xs font-semibold text-indigo-600 truncate">{student.overview}</p>}
                  <p className="text-xs text-gray-500 truncate italic">{student.topicZh || student.topic}</p>
                </td>
                <td className="px-3 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {student.tags.map(tag => (
                      <span key={tag} className="text-xs bg-indigo-50 text-indigo-700 rounded-full px-1.5 py-0.5 whitespace-nowrap">
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">{student.submissionRound ?? '—'}</td>
                <td className="px-3 py-3 min-w-[110px]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${saLow ? 'bg-amber-400' : 'bg-green-400'}`}
                        style={{ width: `${Math.min(100, (saUsed / student.saHoursTotal) * 100)}%` }}
                      />
                    </div>
                    <span className={`text-xs whitespace-nowrap ${saLow ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                      {formatHours(saUsed)}/{student.saHoursTotal}h
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 min-w-[90px]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">{progress}%</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">
                  {last ? `${SESSION_LABEL[last.type]} ${last.date} (${daysSince}d)` : '—'}
                </td>
                <td className="px-3 py-3 text-xs whitespace-nowrap">
                  {next
                    ? <span className="text-indigo-600">{SESSION_LABEL[next.type]} {next.date}</span>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-3 text-xs text-gray-500 max-w-[160px]">
                  <p className="truncate">{student.briefNote}</p>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
