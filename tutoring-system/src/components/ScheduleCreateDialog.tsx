import { useState } from 'react'
import { useStudentStore } from '@/stores/studentStore'
import { getStudent, createScheduleEvent, createTrial } from '@/lib/dataService'
import { countsAsSaHour } from '@/lib/formatters'
import StudentPicker from '@/components/StudentPicker'
import type { ScheduleEvent, SessionRecord, SessionType, Student, Supervisor, Trial } from '@/types'

/**
 * 日程视图的通用「新建」入口：先选类别（课程 / 试听 / 个人事件 / 加个班儿），再填对应字段。
 * 课程分支复用 AddSessionModal 的写入逻辑（拉全量学生 → 追加 session → 重算 SA 课时）。
 * 试听只落排期最小字段，评估打分等留到试听详情页补。
 * 个人事件与加个班儿共用 schedule_events 表，差别只在 countsAsOvertime——
 * 前者是私事不算加班，后者是非学生会议的加班项目，会进加班申请统计。
 */

interface Props {
  students: Student[]
  supervisors: Supervisor[]
  prefill: { date: string; time: string }
  onClose: () => void
  onSaved: () => void
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

const TYPE_PREFIX: Record<SessionType, string> = { SA_MEETING: 'SA', TA_MEETING: 'TA', THEORY: 'TE' }
const TYPE_LABEL: Record<SessionType, string> = { SA_MEETING: 'SA', TA_MEETING: 'TA', THEORY: 'Theory' }

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function computeAutoTitle(sessions: SessionRecord[], type: SessionType, date: string): string {
  const sameType = sessions.filter(s => s.type === type)
  return `${TYPE_PREFIX[type]} #${sameType.filter(s => s.date <= date).length + 1}`
}

export default function ScheduleCreateDialog({ students, supervisors, prefill, onClose, onSaved }: Props) {
  const { saveStudent } = useStudentStore()

  const [kind, setKind] = useState<'session' | 'trial' | 'event' | 'overtime'>('session')
  const [date, setDate] = useState(prefill.date)
  const [time, setTime] = useState(prefill.time)
  const [duration, setDuration] = useState<number | ''>(60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 个人事件
  const [title, setTitle] = useState('')
  const [link, setLink] = useState('')
  const [note, setNote] = useState('')

  // 课程
  const [studentId, setStudentId] = useState<string | null>(null)
  const [sessionType, setSessionType] = useState<SessionType>('SA_MEETING')
  // 试听
  const [trialName, setTrialName] = useState('')
  const [isFinalDefense, setIsFinalDefense] = useState(false)
  const [tutorAttending, setTutorAttending] = useState(false)
  const [titleOverride, setTitleOverride] = useState<string | null>(null)

  const student = students.find(s => s.id === studentId) ?? null
  const isZhongFang = student?.supervisorId
    ? supervisors.find(v => v.id === student.supervisorId)?.saType === '中方SA'
    : false

  // 标题跟着 学生/类型/日期 自动编号（Dashboard 的 summary 已带 sessions 列表）；手改后以手改为准
  const autoTitle = student ? computeAutoTitle(student.sessions ?? [], sessionType, date) : ''
  const sessionTitle = titleOverride ?? autoTitle

  const handleSave = async () => {
    setError('')
    if (!time) { setError('请填写起始时间——没有起始时间的安排不能创建'); return }

    if (kind === 'event' || kind === 'overtime') {
      if (!title.trim()) { setError('请填写标题'); return }
      setSaving(true)
      try {
        const payload: ScheduleEvent = {
          id: generateId(),
          title: title.trim(),
          date,
          time,
          durationMinutes: duration === '' ? (kind === 'overtime' ? 0 : 60) : duration,
          note: note.trim(),
          link: link.trim(),
          countsAsOvertime: kind === 'overtime',
          createdAt: '',
          updatedAt: '',
        }
        await createScheduleEvent(payload)
        onSaved()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
      return
    }

    if (kind === 'trial') {
      if (!trialName.trim()) { setError('请填写试听学生姓名'); return }
      setSaving(true)
      try {
        const now = new Date().toISOString()
        const trial: Trial = {
          id: generateId(),
          date, time,
          durationMinutes: duration === '' ? null : duration,
          studentName: trialName.trim(),
          grade: '', intendedMajor: '', targetUniversity: '', areasOfInterest: '',
          englishLevel: '', trialTopic: '',
          topicFeasibility: null, studentMotivation: null, epqInterest: null, epqSuitability: null,
          enrollmentIntention: '', feedbackForStudent: '', feedbackForConsultant: '',
          retrospective: '', outcome: 'pending',
          createdAt: now, updatedAt: now,
        }
        await createTrial(trial)
        onSaved()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setSaving(false)
      }
      return
    }

    if (!studentId) { setError('请选择学生'); return }
    setSaving(true)
    try {
      // 拉全量学生，避免用 dashboard 的精简数据覆盖 homeworkEntries 等
      const full = await getStudent(studentId)
      const session: SessionRecord = {
        id: generateId(),
        type: sessionType,
        date,
        time,
        durationMinutes: duration === '' ? 0 : duration,
        title: (sessionTitle.trim() || computeAutoTitle(full.sessions, sessionType, date)),
        summary: '',
        homework: '',
        transcript: '',
        privateNotes: '',
        isFinalDefense: sessionType === 'SA_MEETING' ? isFinalDefense : false,
        tutorAttending: sessionType === 'SA_MEETING' ? tutorAttending : false,
        createdAt: new Date().toISOString(),
      }
      const allSessions = [...full.sessions, session]
      const saCount = allSessions.filter(countsAsSaHour).length
      await saveStudent({ ...full, sessions: allSessions, saHoursUsed: saCount })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">新建安排</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* 类别 */}
          <div className="flex gap-2">
            {([['session', '课程'], ['trial', '试听'], ['event', '个人事件'], ['overtime', '加个班儿']] as const).map(([k, label]) => (
              <button
                key={k} type="button"
                onClick={() => {
                  setKind(k); setError('')
                  // 加个班儿先占位、事后补时长，所以默认 0 分钟；别的类别照旧 60
                  setDuration(k === 'overtime' ? 0 : 60)
                }}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                  kind === k ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          {(kind === 'event' || kind === 'overtime') && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">标题 <span className="text-red-500">*</span></label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder={kind === 'overtime' ? '如：教研例会' : '如：陪娃看牙'}
                className={inputCls} autoFocus />
              <p className="text-[11px] text-gray-400 mt-1">
                {kind === 'overtime'
                  ? '非学生会议的加班项目。时长默认 0，事后补上实际时长才进「加班申请」统计（日历里按 60 分钟高度显示）。'
                  : '私事，不计加班时间。'}
              </p>
            </div>
          )}

          {kind === 'trial' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">试听学生姓名 <span className="text-red-500">*</span></label>
              <input value={trialName} onChange={e => setTrialName(e.target.value)} placeholder="如：李明"
                className={inputCls} autoFocus />
              <p className="text-[11px] text-gray-400 mt-1">先占时间；年级、课题、评估打分等在试听详情页补。</p>
            </div>
          )}

          {kind === 'session' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">学生 <span className="text-red-500">*</span></label>
                <StudentPicker students={students} value={studentId} onChange={setStudentId} autoFocus />
              </div>

              <div className="flex gap-2">
                {(['SA_MEETING', 'TA_MEETING', 'THEORY'] as SessionType[]).map(t => (
                  <button
                    key={t} type="button" onClick={() => setSessionType(t)}
                    className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                      sessionType === t ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>

              {sessionType === 'SA_MEETING' && (
                <div className="flex flex-col gap-2 -mt-1">
                  <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
                    <input type="checkbox" checked={isFinalDefense}
                      onChange={e => setIsFinalDefense(e.target.checked)}
                      className="w-4 h-4 accent-[#E11D48]" />
                    标记为最终答辩（不计 SA 课时）
                  </label>
                  {!isZhongFang && !isFinalDefense && (
                    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
                      <input type="checkbox" checked={tutorAttending}
                        onChange={e => setTutorAttending(e.target.checked)}
                        className="w-4 h-4 accent-[#FA8072]" />
                      导师出席本次英方SA会议
                    </label>
                  )}
                </div>
              )}
            </>
          )}

          {/* 日期 / 时间 / 时长 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">日期</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">时间 <span className="text-red-500">*</span></label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">时长(分)</label>
              <input type="number" min={0} value={duration}
                onChange={e => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
                className={inputCls} />
            </div>
          </div>

          {(kind === 'event' || kind === 'overtime') && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">链接</label>
                <input value={link} onChange={e => setLink(e.target.value)} placeholder="会议链接（腾讯会议/Zoom…）"
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">备注</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                  placeholder="可选" className={inputCls} />
              </div>
            </>
          )}

          {kind === 'session' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">课程标题</label>
              <input value={sessionTitle} onChange={e => setTitleOverride(e.target.value)}
                placeholder="选择学生后自动编号" className={inputCls} />
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 bg-[var(--primary)] text-white text-sm py-2 rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors">
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={onClose}
              className="text-sm py-2 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
