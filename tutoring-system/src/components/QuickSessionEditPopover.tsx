import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useStudentStore } from '@/stores/studentStore'
import { getStudent } from '@/lib/dataService'
import type { SessionRecord, Student } from '@/types'
import ZoomImportDialog from '@/components/ZoomImportDialog'

/**
 * Simplified session editor shown from the Gantt view when a session marker is
 * clicked. Covers the day-to-day patch case: a quick-created meeting starts at
 * 0 min, and once it's over the tutor fills in the real duration + a summary
 * (optionally auto-parsed from a Zoom/Tencent recap via 一键输入). For anything
 * heavier there's a "完整编辑" link into the full EditSessionPage.
 */

interface Props {
  studentId: string
  studentName: string
  sessionId: string
  onClose: () => void
  onSaved: () => void
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

const TYPE_LABEL: Record<string, string> = { SA_MEETING: 'SA', TA_MEETING: 'TA', THEORY: 'Theory' }

export default function QuickSessionEditPopover({ studentId, studentName, sessionId, onClose, onSaved }: Props) {
  const { saveStudent } = useStudentStore()

  // Dashboard only holds lightweight summaries (session text may be trimmed), so
  // pull the full student to edit against the real duration / summary.
  const [full, setFull] = useState<Student | null>(null)
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [duration, setDuration] = useState<number | ''>('')
  const [summary, setSummary] = useState('')
  // Zoom import can also yield these; kept so a 一键输入 persists them on save
  // even though they aren't shown in this simplified view.
  const [homework, setHomework] = useState('')
  const [transcript, setTranscript] = useState('')

  const [showZoom, setShowZoom] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getStudent(studentId)
      .then(s => {
        if (!alive) return
        const sess = s.sessions.find(x => x.id === sessionId) ?? null
        setFull(s)
        setSession(sess)
        if (sess) {
          setDuration(sess.durationMinutes || '')
          setSummary(sess.summary ?? '')
          setHomework(sess.homework ?? '')
          setTranscript(sess.transcript ?? '')
        } else {
          setNotFound(true)
        }
      })
      .catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [studentId, sessionId])

  const handleSave = async () => {
    if (!full || !session) return
    setSaving(true)
    setError('')
    try {
      const updatedSession: SessionRecord = {
        ...session,
        durationMinutes: duration === '' ? 0 : duration,
        summary: summary.trim(),
        homework: homework.trim(),
        transcript: transcript.trim(),
        generatedReport: undefined,   // invalidate cached report on edit
        reportGeneratedAt: undefined,
      }
      const updatedSessions = full.sessions.map(s => s.id === sessionId ? updatedSession : s)
      const saCount = updatedSessions.filter(s => s.type === 'SA_MEETING').length
      await saveStudent({ ...full, sessions: updatedSessions, saHoursUsed: saCount })
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const handleZoom = (updates: Partial<Pick<SessionRecord, 'summary' | 'homework' | 'transcript'>>) => {
    if (updates.summary !== undefined) setSummary(updates.summary)
    if (updates.homework !== undefined) setHomework(updates.homework)
    if (updates.transcript !== undefined) setTranscript(updates.transcript)
    setShowZoom(false)
  }

  // While the Zoom dialog is open it owns the screen; render only it.
  if (showZoom && session) {
    return (
      <ZoomImportDialog
        session={{ ...session, summary, homework, transcript }}
        onConfirm={handleZoom}
        onClose={() => setShowZoom(false)}
      />
    )
  }

  const label = session
    ? `${session.title || TYPE_LABEL[session.type] || session.type} · ${session.date}`
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">快速编辑</h2>
            <p className="text-xs text-gray-400 mt-0.5">{studentName}{label ? ` · ${label}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {error && <p className="text-red-500 text-xs">{error}</p>}

          {!full && !error && <p className="text-sm text-gray-400 py-6 text-center">加载中…</p>}
          {notFound && <p className="text-sm text-gray-400 py-6 text-center">找不到该 Session</p>}

          {full && session && (
            <>
              {/* Duration */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">时长（分钟）</label>
                <input
                  type="number" min={1} value={duration} placeholder="—"
                  autoFocus
                  onChange={e => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
                  className={inputCls}
                />
              </div>

              {/* Summary + 一键输入 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-gray-500">记录 Summary</label>
                  <button
                    type="button"
                    onClick={() => setShowZoom(true)}
                    className="text-xs px-2 py-0.5 rounded-md bg-[var(--primary-bg)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-colors"
                  >
                    一键输入（Zoom/腾讯纪要）
                  </button>
                </div>
                <textarea
                  value={summary} onChange={e => setSummary(e.target.value)}
                  rows={5} placeholder="课程记录，会后补即可"
                  className={inputCls}
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button" onClick={handleSave} disabled={saving}
                  className="flex-1 bg-[var(--primary)] text-white text-sm py-2 rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
                <Link
                  to={`/students/${studentId}/session/${sessionId}/edit`}
                  className="text-sm py-2 px-3 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
                >
                  完整编辑
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
