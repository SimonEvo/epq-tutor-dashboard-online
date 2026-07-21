import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStudentStore } from '@/stores/studentStore'
import { getStudent } from '@/lib/dataService'
import { countsAsSaHour } from '@/lib/formatters'
import { parseZoomRecap, type ParsedFields } from '@/components/ZoomImportDialog'
import type { SessionRecord, Student } from '@/types'

/**
 * Simplified session editor shown from the Gantt view when a session marker is
 * clicked. Covers the day-to-day patch case: fix the real time/duration, then
 * paste a Zoom/Tencent recap → 解析 → 确认输入并生成课后报告 (jumps to the report
 * page). For anything heavier there's a "完整编辑" link into EditSessionPage.
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
  const navigate = useNavigate()

  // Dashboard only holds lightweight summaries (session text may be trimmed), so
  // pull the full student to edit against the real record.
  const [full, setFull] = useState<Student | null>(null)
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [time, setTime] = useState('')
  const [duration, setDuration] = useState<number | ''>('')
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [isFinalDefense, setIsFinalDefense] = useState(false)

  // Paste-and-parse flow
  const [rawText, setRawText] = useState('')
  const [parsed, setParsed] = useState<ParsedFields | null>(null)

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
          setTime(sess.time ?? '')
          setDuration(sess.durationMinutes || '')
          setFeedbackSent(sess.feedbackSent ?? false)
          setIsFinalDefense(sess.isFinalDefense ?? false)
        } else {
          setNotFound(true)
        }
      })
      .catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [studentId, sessionId])

  // Metadata-only quick save (time / duration / SA flags). Preserves existing
  // summary/homework/transcript and any cached report.
  const handleSave = async () => {
    if (!full || !session) return
    setError('')
    if (!time) {
      setError('请填写起始时间——会议必须有起始时间')
      return
    }
    setSaving(true)
    try {
      const updatedSession: SessionRecord = {
        ...session,
        time,
        durationMinutes: duration === '' ? 0 : duration,
        feedbackSent,
        isFinalDefense: session.type === 'SA_MEETING' ? isFinalDefense : false,
      }
      const updatedSessions = full.sessions.map(s => s.id === sessionId ? updatedSession : s)
      const saCount = updatedSessions.filter(countsAsSaHour).length
      await saveStudent({ ...full, sessions: updatedSessions, saHoursUsed: saCount })
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const handleParse = () => {
    if (!rawText.trim()) return
    setParsed(parseZoomRecap(rawText))
  }

  const parsedHasContent = !!(parsed && (parsed.summary || parsed.transcript || parsed.homework))

  // Save the parsed record onto the session then jump to the report page, which
  // generates the parent report (and flips feedbackSent on success).
  const handleGenerate = async () => {
    if (!full || !session || !parsed) return
    setError('')
    if (!time) {
      setError('请填写起始时间——会议必须有起始时间')
      return
    }
    setSaving(true)
    try {
      const updatedSession: SessionRecord = {
        ...session,
        time,
        durationMinutes: duration === '' ? 0 : duration,
        summary: parsed.summary || session.summary,
        homework: parsed.homework || session.homework,
        transcript: parsed.transcript || session.transcript,
        isFinalDefense: session.type === 'SA_MEETING' ? isFinalDefense : false,
        generatedReport: undefined,   // force a fresh report from the new content
        reportGeneratedAt: undefined,
      }
      const updatedSessions = full.sessions.map(s => s.id === sessionId ? updatedSession : s)
      const saCount = updatedSessions.filter(countsAsSaHour).length
      await saveStudent({ ...full, sessions: updatedSessions, saHoursUsed: saCount })
      navigate(`/students/${studentId}/session/${sessionId}/report`)
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const label = session
    ? `${session.title || TYPE_LABEL[session.type] || session.type} · ${session.date}${time ? ` ${time}` : ''}`
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
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
              {/* Time + Duration */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">时间 <span className="text-red-500">*</span></label>
                  <input
                    type="time" value={time}
                    onChange={e => setTime(e.target.value)}
                    className={inputCls}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">时长（分钟）</label>
                  <input
                    type="number" min={1} value={duration} placeholder="—"
                    onChange={e => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* SA 会议：课后反馈（首次生成 AI 报告自动置已发送）+ 最终答辩标记 */}
              {session.type === 'SA_MEETING' && (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox" checked={feedbackSent}
                      onChange={e => setFeedbackSent(e.target.checked)}
                      className="w-4 h-4 accent-[var(--primary)]"
                    />
                    课后反馈已发送
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox" checked={isFinalDefense}
                      onChange={e => setIsFinalDefense(e.target.checked)}
                      className="w-4 h-4 accent-[#E11D48]"
                    />
                    标记为最终答辩（不计 SA 课时）
                  </label>
                </div>
              )}

              {/* 粘贴 Zoom/腾讯纪要 → 解析 → 确认生成报告 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">粘贴 Zoom/腾讯会议纪要</label>
                <textarea
                  value={rawText}
                  onChange={e => { setRawText(e.target.value); setParsed(null) }}
                  rows={5}
                  placeholder={"粘贴 Zoom Quick Recap / 腾讯会议纪要，然后点「解析」"}
                  className={`${inputCls} font-mono text-xs resize-none`}
                />
                <button
                  type="button" onClick={handleParse} disabled={!rawText.trim()}
                  className="mt-1.5 text-xs px-4 py-1.5 rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40 transition-colors"
                >
                  解析
                </button>
              </div>

              {/* 解析结果 */}
              {parsed && (
                parsedHasContent ? (
                  <div className="border border-[var(--border)] bg-[var(--primary-bg)] rounded-xl p-3 flex flex-col gap-2">
                    <p className="text-xs font-semibold text-[var(--primary-hover)]">解析结果</p>
                    {parsed.summary    && <PreviewField label="Summary（课程概要）" value={parsed.summary} />}
                    {parsed.transcript && <PreviewField label="Transcript（完整记录）" value={parsed.transcript} clamp />}
                    {parsed.homework   && <PreviewField label="Homework（作业/下一步）" value={parsed.homework} />}
                    <button
                      type="button" onClick={handleGenerate} disabled={saving}
                      className="mt-1 w-full bg-[var(--primary)] text-white text-sm py-2 rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
                    >
                      {saving ? '保存中…' : '确认输入并生成课后报告'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    未识别到章节。请确认包含 <strong>Quick Recap / 快速回顾</strong>、<strong>Summary / 摘要</strong>、<strong>Next Steps / 后续步骤</strong> 等标题。
                  </p>
                )
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button" onClick={handleSave} disabled={saving}
                  className="flex-1 text-sm py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中…' : '仅保存时间/时长'}
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

function PreviewField({ label, value, clamp }: { label: string; value: string; clamp?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xs text-gray-700 bg-white rounded-lg p-2 border border-[var(--border)] whitespace-pre-wrap leading-relaxed ${clamp ? 'line-clamp-4' : ''}`}>
        {value}
      </p>
    </div>
  )
}
