import type { Student } from '@/types'
import { EPQ_MILESTONES } from '@/config'
import StudentCompactCard from './StudentCompactCard'

interface Props {
  students: Student[]
}

const STAGES = [
  { label: '未开始', textCls: 'text-gray-600', bgCls: 'bg-gray-100', min: 0, max: 0 },
  { label: '起步阶段', textCls: 'text-blue-700', bgCls: 'bg-blue-50', min: 1, max: 30 },
  { label: '进行中', textCls: 'text-amber-700', bgCls: 'bg-amber-50', min: 31, max: 70 },
  { label: '攻坚阶段', textCls: 'text-orange-700', bgCls: 'bg-orange-50', min: 71, max: 90 },
  { label: '收尾/完成', textCls: 'text-green-700', bgCls: 'bg-green-50', min: 91, max: 100 },
]

function getProgress(s: Student) {
  const applicable = EPQ_MILESTONES.filter(m => !m.optional || s.milestones[m.id] !== 'na')
  const done = applicable.filter(m => s.milestones[m.id] === 'completed').length
  return applicable.length > 0 ? Math.round((done / applicable.length) * 100) : 0
}

export default function KanbanProgressView({ students }: Props) {
  const grouped: Record<string, Student[]> = Object.fromEntries(STAGES.map(s => [s.label, []]))

  for (const s of students) {
    const pct = getProgress(s)
    const stage = STAGES.find(st => pct === 0 ? st.min === 0 : pct >= st.min && pct <= st.max) ?? STAGES[0]
    grouped[stage.label].push(s)
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 items-start">
      {STAGES.map(stage => {
        const group = grouped[stage.label]
        return (
          <div key={stage.label} className="flex-shrink-0 w-60 flex flex-col gap-2">
            <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg ${stage.bgCls}`}>
              <h3 className={`text-sm font-semibold ${stage.textCls}`}>{stage.label}</h3>
              <span className="text-xs text-gray-400 bg-white rounded-full px-2 py-0.5">{group.length}人</span>
            </div>
            <div className="flex flex-col gap-2 min-h-[60px]">
              {group.length === 0
                ? <p className="text-xs text-gray-300 text-center py-6">暂无学生</p>
                : group.map(s => <StudentCompactCard key={s.id} student={s} />)
              }
            </div>
          </div>
        )
      })}
    </div>
  )
}
