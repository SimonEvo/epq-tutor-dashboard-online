import { useState, useEffect } from 'react'
import { useStudentStore } from '@/stores/studentStore'
import { getStudent } from '@/lib/dataService'
import type { SessionRecord, SessionType, Student } from '@/types'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

const TYPE_PREFIX: Record<SessionType, string> = {
  SA_MEETING: 'SA',
  TA_MEETING: 'TA',
  THEORY: 'TE',
}

function computeAutoTitle(sessions: SessionRecord[], type: SessionType, date: string): string {
  const sorted = sessions.filter(s => s.type === type).sort((a, b) => a.date.localeCompare(b.date))
  return `${TYPE_PREFIX[type]} #${sorted.filter(s => s.date <= date).length + 1}`
}

interface Props {
  student: Student
  onClose: () => void
  onSaved: () => void
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function AddSessionModal({ student, onClose, onSaved }: Props) {
  const { saveStudent } = useStudentStore()
  const todayStr = new Date().toISOString().slice(0, 10)

  const [type, setType] = useState<SessionType>('SA_MEETING')
  const [date, setDate] = useState(todayStr)
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState<number | ''>('')
  const [title, setTitle] = useState(() => computeAutoTitle(student.sessions, 'SA_MEETING', todayStr))
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setTitle(computeAutoTitle(student.sessions, type, date))
  }, [type, date, student.sessions])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const session: SessionRecord = {
        id: generateId(),
        type,
        date,
        time: time || undefined,
        durationMinutes: duration === '' ? 0 : duration,
        title: title.trim(),
        summary: summary.trim(),
        homework: '',
        transcript: '',
        privateNotes: '',
        createdAt: new Date().toISOString(),
      }
      // Fetch full student to preserve homeworkEntries, personalEntries etc.
      // (dashboard only loads summary which has empty arrays)
      const full = await getStudent(student.id)
      const allSessions = [...full.sessions, session]
      const saCount = allSessions.filter(s => s.type === 'SA_MEETING').length
      await saveStudent({ ...full, sessions: allSessions, saHoursUsed: saCount })
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">Add Session</h2>
            <p className="text-xs text-gray-400 mt-0.5">{student.name}{student.nameEn ? ` · ${student.nameEn}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          {/* Type */}
          <div className="flex gap-2">
            {(['SA_MEETING', 'TA_MEETING', 'THEORY'] as SessionType[]).map(t => (
              <button
                key={t} type="button" onClick={() => setType(t)}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                  type === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {t === 'SA_MEETING' ? 'SA' : t === 'TA_MEETING' ? 'TA' : 'Theory'}
              </button>
            ))}
          </div>

          {/* Date / Time / Duration */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duration (min)</label>
              <input type="number" min={1} value={duration} placeholder="—"
                onChange={e => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
                className={inputCls} />
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
          </div>

          {/* Summary */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Summary</label>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2}
              placeholder="Optional" className={inputCls} />
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 bg-indigo-600 text-white text-sm py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save Session'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 text-sm py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
