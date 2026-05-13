import { Link } from 'react-router-dom'
import type { Student } from '@/types'
import { EPQ_MILESTONES } from '@/config'
import { formatHours, isSessionStarted } from '@/lib/formatters'

interface Props {
  student: Student
}

export default function StudentCompactCard({ student }: Props) {
  const applicable = EPQ_MILESTONES.filter(m => !m.optional || student.milestones[m.id] !== 'na')
  const completed = applicable.filter(m => student.milestones[m.id] === 'completed').length
  const progress = applicable.length > 0 ? Math.round((completed / applicable.length) * 100) : 0

  const pastSaHoursUsed = student.sessions
    .filter(s => s.type === 'SA_MEETING' && isSessionStarted(s))
    .reduce((sum, s) => sum + s.durationMinutes / 60, 0)
  const saLow = student.saHoursTotal - pastSaHoursUsed <= 2

  const lastMeeting = [...student.sessions]
    .filter(s => (s.type === 'SA_MEETING' || s.type === 'TA_MEETING') && isSessionStarted(s))
    .sort((a, b) => b.date.localeCompare(a.date))[0]
  const daysSinceLast = lastMeeting
    ? Math.floor((Date.now() - new Date(lastMeeting.date).getTime()) / 86400000)
    : null

  const urgencyBorder = daysSinceLast === null
    ? 'border-l-gray-200'
    : daysSinceLast > 14 ? 'border-l-red-400'
    : daysSinceLast > 7 ? 'border-l-amber-400'
    : 'border-l-green-400'

  const nextSa = [...student.sessions]
    .filter(s => s.type === 'SA_MEETING' && !isSessionStarted(s))
    .sort((a, b) => a.date.localeCompare(b.date))[0]

  return (
    <Link
      to={`/students/${student.id}`}
      className={`block bg-white rounded-lg border border-gray-200 border-l-4 ${urgencyBorder} p-3 hover:shadow-sm transition-shadow`}
    >
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div>
          <p className="font-medium text-gray-900 text-sm leading-tight">{student.name}</p>
          {student.nameEn && <p className="text-xs text-gray-400">{student.nameEn}</p>}
          {student.overview && <p className="text-xs font-semibold text-indigo-600 mt-0.5">{student.overview}</p>}
        </div>
        {student.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap justify-end">
            {student.tags.map(tag => (
              <span key={tag} className="text-xs bg-indigo-50 text-indigo-700 rounded-full px-1.5 py-0.5 whitespace-nowrap">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mb-1.5">
        <div className="flex justify-between text-xs text-gray-400 mb-0.5">
          <span>EPQ</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className={saLow ? 'text-amber-600 font-medium' : 'text-gray-400'}>
          SA {formatHours(pastSaHoursUsed)} / {student.saHoursTotal}h
        </span>
        {nextSa && <span className="text-indigo-500">Next: {nextSa.date}</span>}
      </div>
    </Link>
  )
}
