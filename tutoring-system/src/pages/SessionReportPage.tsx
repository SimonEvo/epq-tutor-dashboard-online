import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useStudentStore } from '@/stores/studentStore'
import { generateSessionReport } from '@/lib/claudeService'
import { getSettings } from '@/lib/settings'
import * as dataService from '@/lib/dataService'
import type { Student } from '@/types'

function daysAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '1 天前'
  return `${diff} 天前`
}

export default function SessionReportPage() {
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>()
  const { saveStudent } = useStudentStore()

  const [student, setStudent] = useState<Student | null>(null)
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [extraContext, setExtraContext] = useState('')

  useEffect(() => {
    if (!id) return
    dataService.getStudent(id).then(s => {
      setStudent(s)
      const session = s.sessions.find(x => x.id === sessionId)
      if (!session) return
      if (session.reportExtraContext) setExtraContext(session.reportExtraContext)
      if (session.generatedReport) {
        setReport(session.generatedReport)
        setFromCache(true)
      } else {
        generateFor(s)
      }
    }).catch(() => {})
  }, [id, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const generateFor = async (s: Student, force = false) => {
    const session = s.sessions.find(x => x.id === sessionId)
    if (!session) return
    setLoading(true)
    setError('')
    setFromCache(false)
    if (force) setReport('')
    try {
      const text = await generateSessionReport(s, session, extraContext)
      setReport(text)
      setSaving(true)
      const updatedSession = { ...session, generatedReport: text, reportGeneratedAt: new Date().toISOString(), reportExtraContext: extraContext.trim() || undefined }
      const updatedSessions = s.sessions.map(x => x.id === sessionId ? updatedSession : x)
      const updated: Student = { ...s, sessions: updatedSessions }
      await saveStudent(updated)
      setStudent(updated)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
      setSaving(false)
    }
  }

  const session = student?.sessions.find(x => x.id === sessionId)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = report
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!student) {
    return <div className="p-6 text-gray-400 text-sm">Loading… <Link to="/" className="text-[var(--primary)] underline">Back to dashboard</Link></div>
  }
  if (!session) {
    return <div className="p-6 text-gray-400 text-sm">Session not found. <Link to={`/students/${id}`} className="text-[var(--primary)] underline">Back</Link></div>
  }

  const sessionTypeLabel = session.type === 'SA_MEETING' ? 'SA Meeting'
    : session.type === 'TA_MEETING' ? 'TA Meeting'
    : 'Taught Element'

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/students/${student.id}`} className="text-gray-400 hover:text-gray-600 text-sm">
          ← {student.name}{student.nameEn ? ` · ${student.nameEn}` : ''}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-400 text-sm">{session.title || sessionTypeLabel} · {session.date}</span>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">课后报告</h1>
      </div>

      {/* 额外补充：英方督导发来的文字 / 导师临时补充 */}
      <div className="mb-3">
        <label className="text-xs font-medium text-gray-500 mb-1 block">
          额外补充（可选）— 英方督导发来的文字、或你想补充的情况，会一并交给 AI
        </label>
        <textarea
          value={extraContext}
          onChange={e => setExtraContext(e.target.value)}
          rows={3}
          placeholder="例如：督导反馈学生本节课表现、需要强调的进度、家长特别关心的点…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-y"
        />
        <p className="text-xs text-gray-400 mt-1">填写／修改后点「{report ? '重新生成' : '生成报告'}」生效</p>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => generateFor(student, true)}
          disabled={loading || saving}
          className="text-sm px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {loading ? '生成中…' : report ? '重新生成' : '生成报告'}
        </button>
        {report && (
          <>
            <button onClick={copy} className="text-sm px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition-colors">
              {copied ? '已复制 ✓' : '复制报告'}
            </button>
            {student.tencentDocUrl && (
              <a href={student.tencentDocUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                打开腾讯文档 →
              </a>
            )}
          </>
        )}
        {fromCache && session.reportGeneratedAt && (
          <span className="text-xs text-gray-400 ml-1">已缓存 · {daysAgo(session.reportGeneratedAt)}生成</span>
        )}
        {saving && <span className="text-xs text-gray-400 ml-1">保存中…</span>}
      </div>

      {loading && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 flex items-center justify-center gap-3 text-gray-400 text-sm">
          <span className="animate-spin text-[var(--primary)]">⟳</span>
          正在调用 {getSettings().aiModel || 'qwen-plus'} 生成报告，请稍候…
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-700">
          <p className="font-medium mb-1">生成失败</p>
          <p>{error}</p>
          {error.includes('API Key') && (
            <Link to="/settings" className="text-[var(--primary)] underline mt-2 block">前往设置填写 API Key →</Link>
          )}
        </div>
      )}
      {report && !loading && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <pre className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed font-sans">{report}</pre>
        </div>
      )}
      {!report && !loading && !error && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          点击「生成报告」开始
        </div>
      )}
    </div>
  )
}
