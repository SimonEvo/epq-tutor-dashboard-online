import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { listTrials, createTrial, saveTrial } from '@/lib/dataService'
import type { Trial, TrialOutcome, TrialDurationCategory, TrialGrade, TrialEnrollmentIntention } from '@/types'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function RatingInput({ label, value, onChange }: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-2">{label}</label>
      <div className="flex items-center gap-1 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(value === i ? null : i)}
            className={`w-8 h-8 text-xs rounded-lg border transition-colors ${
              value === i
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
            }`}
          >
            {i}
          </button>
        ))}
        {value !== null && (
          <span className="text-xs text-indigo-600 font-medium ml-1">{value}</span>
        )}
      </div>
    </div>
  )
}

export default function TrialDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const isNew = (location.state as { isNew?: boolean } | null)?.isNew ?? false

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [converting, setConverting] = useState(false)

  // Form state
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [durationCategory, setDurationCategory] = useState<TrialDurationCategory>('')
  const [studentName, setStudentName] = useState('')
  const [grade, setGrade] = useState<TrialGrade>('')
  const [intendedMajor, setIntendedMajor] = useState('')
  const [targetUniversity, setTargetUniversity] = useState('')
  const [areasOfInterest, setAreasOfInterest] = useState('')
  const [englishLevel, setEnglishLevel] = useState('')
  const [trialTopic, setTrialTopic] = useState('')
  const [topicFeasibility, setTopicFeasibility] = useState<number | null>(null)
  const [studentMotivation, setStudentMotivation] = useState<number | null>(null)
  const [epqInterest, setEpqInterest] = useState<number | null>(null)
  const [epqSuitability, setEpqSuitability] = useState<number | null>(null)
  const [enrollmentIntention, setEnrollmentIntention] = useState<TrialEnrollmentIntention>('')
  const [feedbackForStudent, setFeedbackForStudent] = useState('')
  const [feedbackForConsultant, setFeedbackForConsultant] = useState('')
  const [retrospective, setRetrospective] = useState('')
  const [outcome, setOutcome] = useState<TrialOutcome>('pending')
  const [linkedStudentId, setLinkedStudentId] = useState<string | undefined>(undefined)
  const [createdAt, setCreatedAt] = useState('')

  useEffect(() => {
    if (isNew || !id) { setLoading(false); return }
    listTrials().then(trials => {
      const t = trials.find(x => x.id === id)
      if (!t) { navigate('/trials', { replace: true }); return }
      setDate(t.date)
      setDurationCategory(t.durationCategory)
      setStudentName(t.studentName)
      setGrade(t.grade)
      setIntendedMajor(t.intendedMajor)
      setTargetUniversity(t.targetUniversity)
      setAreasOfInterest(t.areasOfInterest)
      setEnglishLevel(t.englishLevel)
      setTrialTopic(t.trialTopic)
      setTopicFeasibility(t.topicFeasibility)
      setStudentMotivation(t.studentMotivation)
      setEpqInterest(t.epqInterest)
      setEpqSuitability(t.epqSuitability)
      setEnrollmentIntention(t.enrollmentIntention)
      setFeedbackForStudent(t.feedbackForStudent)
      setFeedbackForConsultant(t.feedbackForConsultant)
      setRetrospective(t.retrospective)
      setOutcome(t.outcome)
      setLinkedStudentId(t.linkedStudentId)
      setCreatedAt(t.createdAt)
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [id, isNew, navigate])

  const buildTrial = (): Trial => {
    const now = new Date().toISOString()
    return {
      id: id!,
      date, durationCategory, studentName, grade, intendedMajor,
      targetUniversity, areasOfInterest, englishLevel, trialTopic,
      topicFeasibility, studentMotivation, epqInterest, epqSuitability,
      enrollmentIntention, feedbackForStudent, feedbackForConsultant,
      retrospective, outcome, linkedStudentId,
      createdAt: createdAt || now,
      updatedAt: now,
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const trial = buildTrial()
      if (isNew) {
        await createTrial(trial)
      } else {
        await saveTrial(trial)
      }
      navigate('/trials')
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const handleConvertToStudent = async () => {
    if (!confirm('将此试听记录转为学生档案？将跳转到新建学生页面，部分字段已预填。')) return
    setConverting(true)
    try {
      // Save current state first, marking outcome as deal_mine
      const tempId = generateId()
      const trial = { ...buildTrial(), outcome: 'deal_mine' as TrialOutcome, linkedStudentId: tempId }
      if (isNew) {
        await createTrial(trial)
      } else {
        await saveTrial(trial)
      }
      // Navigate to new student page with pre-filled data via router state
      navigate('/students/new', {
        state: {
          fromTrial: {
            trialId: id,
            name: studentName,
            currentGrade: grade,
            universityAspiration: targetUniversity,
            topic: trialTopic,
            overview: intendedMajor,
          }
        }
      })
    } catch (e) {
      setError(String(e))
      setConverting(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  const fieldClass = "w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
  const labelClass = "block text-xs font-medium text-gray-600 mb-1"

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/trials" className="text-gray-400 hover:text-gray-600 text-sm">← 试听课</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">
          {isNew ? '新建试听课' : (studentName || '试听课详情')}
        </h1>
      </div>

      <form onSubmit={handleSave} className="space-y-6">

        {/* ── 基本信息 ── */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">基本信息</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>试听日期</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={fieldClass} required />
            </div>
            <div>
              <label className={labelClass}>时长</label>
              <select value={durationCategory} onChange={e => setDurationCategory(e.target.value as TrialDurationCategory)} className={fieldClass}>
                <option value="">—</option>
                <option value="<45">小于 45 分钟</option>
                <option value="46-60">46–60 分钟</option>
                <option value="61-75">61–75 分钟</option>
                <option value=">75">大于 75 分钟</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>学生姓名</label>
              <input value={studentName} onChange={e => setStudentName(e.target.value)} className={fieldClass} placeholder="姓名" />
            </div>
            <div>
              <label className={labelClass}>年级</label>
              <select value={grade} onChange={e => setGrade(e.target.value as TrialGrade)} className={fieldClass}>
                <option value="">—</option>
                <option value="高一">高一</option>
                <option value="高二">高二</option>
                <option value="高三">高三</option>
                <option value="其他">其他</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>意向专业</label>
              <input value={intendedMajor} onChange={e => setIntendedMajor(e.target.value)} className={fieldClass} placeholder="如：计算机科学" />
            </div>
            <div>
              <label className={labelClass}>意向高校</label>
              <input value={targetUniversity} onChange={e => setTargetUniversity(e.target.value)} className={fieldClass} placeholder="如：帝国理工学院" />
            </div>
          </div>

          <div>
            <label className={labelClass}>感兴趣的领域</label>
            <input value={areasOfInterest} onChange={e => setAreasOfInterest(e.target.value)} className={fieldClass} placeholder="学生感兴趣的领域" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>英语水平</label>
              <input value={englishLevel} onChange={e => setEnglishLevel(e.target.value)} className={fieldClass} placeholder="如：流利 / B2" />
            </div>
            <div>
              <label className={labelClass}>试听选题</label>
              <input value={trialTopic} onChange={e => setTrialTopic(e.target.value)} className={fieldClass} placeholder="本次试听课的选题" />
            </div>
          </div>
        </section>

        {/* ── 评分 ── */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-5">
          <h2 className="text-sm font-semibold text-gray-700">评分（0–10）</h2>
          <RatingInput label="选题可行性" value={topicFeasibility} onChange={setTopicFeasibility} />
          <RatingInput label="学生积极性" value={studentMotivation} onChange={setStudentMotivation} />
          <RatingInput label="对 EPQ 感兴趣程度" value={epqInterest} onChange={setEpqInterest} />
          <RatingInput label="参加 EPQ 适合程度" value={epqSuitability} onChange={setEpqSuitability} />
          <div>
            <label className={labelClass}>报名意愿</label>
            <div className="flex gap-2">
              {(['低', '中', '高'] as TrialEnrollmentIntention[]).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setEnrollmentIntention(enrollmentIntention === v ? '' : v)}
                  className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
                    enrollmentIntention === v
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── 反馈留底 ── */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">反馈留底（金数据）</h2>
          <div>
            <label className={labelClass}>对学生的文字反馈</label>
            <textarea
              value={feedbackForStudent}
              onChange={e => setFeedbackForStudent(e.target.value)}
              className={`${fieldClass} min-h-[100px] resize-y`}
              placeholder="以试听课老师角度对学生的点评，以表扬鼓励为主（100-200字）"
            />
          </div>
          <div>
            <label className={labelClass}>对顾问的反馈</label>
            <textarea
              value={feedbackForConsultant}
              onChange={e => setFeedbackForConsultant(e.target.value)}
              className={`${fieldClass} min-h-[80px] resize-y`}
              placeholder="英语对话情况、性格特点、对EPQ的判断等…"
            />
          </div>
        </section>

        {/* ── 复盘（私密）── */}
        <section className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
          <h2 className="text-sm font-semibold text-amber-800 mb-3">复盘（仅自用）</h2>
          <textarea
            value={retrospective}
            onChange={e => setRetrospective(e.target.value)}
            className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white min-h-[80px] resize-y"
            placeholder="这次课的节奏、学生反应、下次要改进的地方…"
          />
        </section>

        {/* ── 结果 ── */}
        <section className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">结果</h2>
          <div className="flex flex-wrap gap-2">
            {([
              ['pending', '待定'],
              ['no_deal', '未成单'],
              ['deal_mine', '成单·给我'],
              ['deal_other', '成单·给其他老师'],
            ] as [TrialOutcome, string][]).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setOutcome(v)}
                className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
                  outcome === v
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {outcome === 'deal_mine' && !linkedStudentId && (
            <div className="mt-4 p-3 bg-green-50 rounded-xl border border-green-100 flex items-center justify-between">
              <p className="text-sm text-green-700">已标记为「成单·给我」——可一键转为学生档案</p>
              <button
                type="button"
                onClick={handleConvertToStudent}
                disabled={converting}
                className="text-sm px-4 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors shrink-0 ml-3"
              >
                {converting ? '跳转中…' : '转为学生'}
              </button>
            </div>
          )}

          {linkedStudentId && (
            <div className="mt-4 p-3 bg-green-50 rounded-xl border border-green-100 flex items-center gap-2">
              <span className="text-sm text-green-700">已关联学生档案</span>
              <Link
                to={`/students/${linkedStudentId}`}
                className="text-sm text-green-700 underline hover:text-green-900"
              >
                查看学生
              </Link>
            </div>
          )}
        </section>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pb-6">
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <Link to="/trials" className="text-sm px-5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            取消
          </Link>
        </div>
      </form>
    </div>
  )
}
