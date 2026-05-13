import { Link } from 'react-router-dom'
import type { Student } from '@/types'
import { EPQ_MILESTONES } from '@/config'

interface Props {
  students: Student[]
}

const TABLE_IDS = ['table1', 'table2', 'table4', 'table5', 'table6', 'table7', 'table11']
const ESSAY_IDS = ['intro', 'lit_review', 'methodology', 'results', 'discussion', 'reflection', 'conclusion', 'bibliography', 'abstract']
const OTHER_IDS = ['questionnaire', 'defense', 'submission']

const TABLE_MS = EPQ_MILESTONES.filter(m => TABLE_IDS.includes(m.id))
const ESSAY_MS = EPQ_MILESTONES.filter(m => ESSAY_IDS.includes(m.id))
const OTHER_MS = EPQ_MILESTONES.filter(m => OTHER_IDS.includes(m.id))

function MilestoneBadge({ status, label }: { status: string | undefined; label: string }) {
  if (status === 'completed')
    return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium whitespace-nowrap">{label} ✓</span>
  if (status === 'in_progress')
    return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium whitespace-nowrap">{label} ◐</span>
  if (status === 'na')
    return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 line-through whitespace-nowrap">{label}</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 whitespace-nowrap">{label}</span>
}

export default function MilestoneGridView({ students }: Props) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {students.map(student => (
        <Link
          key={student.id}
          to={`/students/${student.id}`}
          className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-semibold text-gray-900 text-sm">{student.name}</span>
              {student.nameEn && <span className="text-gray-400 text-sm ml-1.5">{student.nameEn}</span>}
              {student.overview && <p className="text-xs font-semibold text-indigo-600 mt-0.5">{student.overview}</p>}
            </div>
            {student.submissionRound && (
              <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 shrink-0 ml-2">
                {student.submissionRound}
              </span>
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">表格</p>
              <div className="flex flex-col gap-1">
                {TABLE_MS.map(m => (
                  <MilestoneBadge key={m.id} status={student.milestones[m.id]} label={m.label} />
                ))}
              </div>
            </div>
            <div className="w-px bg-gray-100 self-stretch" />
            <div className="flex-1">
              <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">论文</p>
              <div className="flex flex-col gap-1">
                {ESSAY_MS.map(m => (
                  <MilestoneBadge key={m.id} status={student.milestones[m.id]} label={m.label} />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-gray-100">
            {OTHER_MS.map(m => (
              <MilestoneBadge key={m.id} status={student.milestones[m.id]} label={m.label} />
            ))}
          </div>
        </Link>
      ))}
    </div>
  )
}
