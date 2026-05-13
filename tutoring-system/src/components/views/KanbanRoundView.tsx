import type { Student } from '@/types'
import { formatHours, isSessionStarted } from '@/lib/formatters'
import StudentCompactCard from './StudentCompactCard'

interface Props {
  students: Student[]
  rounds: string[]
}

function totalSaHours(list: Student[]) {
  return list.reduce((sum, s) =>
    sum + s.sessions
      .filter(x => x.type === 'SA_MEETING' && isSessionStarted(x))
      .reduce((h, x) => h + x.durationMinutes / 60, 0),
  0)
}

export default function KanbanRoundView({ students, rounds }: Props) {
  const grouped: Record<string, Student[]> = {}
  for (const r of rounds) grouped[r] = []
  grouped['未分配'] = []

  for (const s of students) {
    if (s.submissionRound && grouped[s.submissionRound] !== undefined) {
      grouped[s.submissionRound].push(s)
    } else {
      grouped['未分配'].push(s)
    }
  }

  const columns = [...rounds, '未分配'].filter(r => grouped[r]?.length > 0 || rounds.includes(r))

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 items-start">
      {columns.map(round => {
        const group = grouped[round] ?? []
        const total = totalSaHours(group)
        return (
          <div key={round} className="flex-shrink-0 w-60 flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-gray-700">{round}</h3>
              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{group.length}人</span>
            </div>
            <div className="flex flex-col gap-2 min-h-[60px]">
              {group.length === 0
                ? <p className="text-xs text-gray-300 text-center py-6">暂无学生</p>
                : group.map(s => <StudentCompactCard key={s.id} student={s} />)
              }
            </div>
            {group.length > 0 && (
              <div className="text-xs text-gray-400 text-center pt-1 border-t border-gray-100">
                已用 SA 共 {formatHours(total)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
