import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useStudentStore } from '@/stores/studentStore'
import { EPQ_MILESTONES } from '@/config'
import type { Student, MilestoneProgress, TrialOutcome } from '@/types'
import { listTrials, saveTrial } from '@/lib/dataService'
import StudentFormFields, { useStudentFormState, buildStudentFromForm } from '@/components/StudentFormFields'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function buildDefaultMilestones(): MilestoneProgress {
  const m: MilestoneProgress = {}
  EPQ_MILESTONES.forEach(ms => { m[ms.id] = ms.optional ? 'na' : 'not_started' })
  return m
}

export default function NewStudentPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const fromTrial = (location.state as { fromTrial?: {
    trialId: string; name: string; currentGrade: string;
    universityAspiration: string; topic: string; overview: string
  } } | null)?.fromTrial

  const { saveStudent, tags: globalTags, fetchTags, saveTags, rounds: globalRounds, fetchRounds, saveRounds, supervisors, fetchSupervisors } = useStudentStore()

  useEffect(() => { fetchSupervisors(); fetchRounds() }, [fetchSupervisors, fetchRounds])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const formState = useStudentFormState(fromTrial ? {
    name: fromTrial.name,
    currentGrade: fromTrial.currentGrade,
    universityAspiration: fromTrial.universityAspiration,
    topic: fromTrial.topic,
    overview: fromTrial.overview,
  } : undefined)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formState.name.trim() || !formState.topic.trim()) return
    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      const student: Student = {
        ...buildStudentFromForm(formState),
        id: generateId(),
        saHoursUsed: 0,
        personalEntries: [],
        milestones: buildDefaultMilestones(),
        sessions: [],
        createdAt: now,
        updatedAt: now,
      }
      await saveStudent(student)
      // Link trial record back to the new student
      if (fromTrial) {
        try {
          const trials = await listTrials()
          const trial = trials.find(t => t.id === fromTrial.trialId)
          if (trial) {
            await saveTrial({ ...trial, outcome: 'deal_mine' as TrialOutcome, linkedStudentId: student.id })
          }
        } catch {
          // non-fatal
        }
      }
      navigate(`/students/${student.id}`)
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">Add Student</h1>
      </div>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-5">
        <StudentFormFields
          state={formState}
          globalTags={globalTags}
          globalRounds={globalRounds}
          supervisors={supervisors}
          onSaveTag={async (tag) => { await saveTags([...globalTags, tag]); await fetchTags() }}
          onSaveRound={async (round) => { await saveRounds([...globalRounds, round]); await fetchRounds() }}
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !formState.name.trim() || !formState.topic.trim()}
            className="bg-[var(--primary)] text-white text-sm px-5 py-2 rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Create Student'}
          </button>
          <Link to="/" className="text-sm px-5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
