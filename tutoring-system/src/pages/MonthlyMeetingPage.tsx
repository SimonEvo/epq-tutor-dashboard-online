import { useState, useEffect } from 'react'
import { listStudents, getDefaultRound, getRounds, patchStudentAlias } from '@/lib/dataService'
import { generateMonthlyReport, generateAiAlias } from '@/lib/claudeService'
import type { Student } from '@/types'

// ── cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  content: string
  generatedAt: string
}

function cacheKey(round: string, year: number, month: number) {
  return `monthly-meeting-${round}-${year}-${String(month).padStart(2, '0')}`
}

function loadCache(round: string, year: number, month: number): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(round, year, month))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveCache(round: string, year: number, month: number, content: string) {
  const entry: CacheEntry = { content, generatedAt: new Date().toISOString() }
  localStorage.setItem(cacheKey(round, year, month), JSON.stringify(entry))
}

function clearCache(round: string, year: number, month: number) {
  localStorage.removeItem(cacheKey(round, year, month))
}

// ── output renderer ───────────────────────────────────────────────────────────

function parseOutput(text: string): { slide2: string; progress: string } {
  const s2Match = text.match(/##\s*Slide 2[^\n]*\n([\s\S]*?)(?=##|$)/)
  const progMatch = text.match(/##\s*学生进度[^\n]*\n([\s\S]*?)(?=##|$)/)
  return {
    slide2: s2Match ? s2Match[1].trim() : '',
    progress: progMatch ? progMatch[1].trim() : text.trim(),
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function MonthlyMeetingPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [round, setRound] = useState('')
  const [rounds, setRounds] = useState<string[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cache, setCache] = useState<CacheEntry | null>(null)

  // Load students + rounds + default round
  useEffect(() => {
    Promise.all([listStudents(), getRounds(), getDefaultRound()])
      .then(([studs, rs, def]) => {
        setStudents(studs)
        setRounds(rs)
        const saved = localStorage.getItem('dashboard-round') ?? ''
        setRound(saved || def || rs[0] || '')
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Reload cache when round/month changes
  useEffect(() => {
    if (round) setCache(loadCache(round, year, month))
  }, [round, year, month])

  const activeStudents = round
    ? students.filter(s => s.submissionRound === round)
    : students

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const ensureAliases = async (studs: Student[]): Promise<Student[]> => {
    const existing = studs.map(s => s.aiAlias).filter(Boolean) as string[]
    const toFix = studs.filter(s => !s.aiAlias)
    if (toFix.length === 0) return studs

    const updated = await Promise.all(
      studs.map(async s => {
        if (s.aiAlias) return s
        const alias = generateAiAlias(existing)
        existing.push(alias)
        await patchStudentAlias(s.id, alias)  // 只改 ai_alias，不触碰 sessions
        return { ...s, aiAlias: alias }
      })
    )
    setStudents(prev => prev.map(s => updated.find(u => u.id === s.id) ?? s))
    return updated
  }

  const generate = async (forceRegen = false) => {
    if (forceRegen) clearCache(round, year, month)
    setGenerating(true)
    setError(null)
    try {
      const studs = await ensureAliases(activeStudents)
      const content = await generateMonthlyReport(studs, year, month)
      saveCache(round, year, month, content)
      setCache({ content, generatedAt: new Date().toISOString() })
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        加载中…
      </div>
    )
  }

  const parsed = cache ? parseOutput(cache.content) : null
  const generatedAt = cache
    ? new Date(cache.generatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-800">月会草稿</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          AI 根据本月课程记录生成，供参考填写 PPT 模板
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Round selector */}
        <select
          value={round}
          onChange={e => setRound(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none"
        >
          {rounds.map(r => <option key={r} value={r}>{r}</option>)}
          {rounds.length === 0 && <option value="">全部</option>}
        </select>

        {/* Month picker */}
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="px-2 py-1 rounded hover:bg-slate-100 text-slate-600">‹</button>
          <span className="text-sm font-medium text-slate-700 w-20 text-center">
            {year}年{month}月
          </span>
          <button onClick={nextMonth} className="px-2 py-1 rounded hover:bg-slate-100 text-slate-600">›</button>
        </div>

        <span className="text-xs text-slate-400">
          {activeStudents.length} 名学生
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Content or generate button */}
      {!cache ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="text-sm text-slate-400">还没有 {year}年{month}月 的草稿</p>
          <button
            onClick={() => generate(false)}
            disabled={generating || activeStudents.length === 0}
            className="px-6 py-2.5 rounded-lg bg-[#000A38] text-white text-sm font-medium hover:bg-[#001066] disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {generating
              ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />生成中…</>
              : 'AI 生成草稿'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Meta bar */}
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>上次生成：{generatedAt}</span>
            <button
              onClick={() => generate(true)}
              disabled={generating}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 disabled:opacity-50 transition-colors"
            >
              {generating
                ? <><span className="animate-spin inline-block w-3 h-3 border border-slate-500 border-t-transparent rounded-full" />重新生成…</>
                : '↺ 重新生成'}
            </button>
          </div>

          {/* Slide 2: Keywords */}
          {parsed?.slide2 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  Slide 2 · 本月主要教学动作关键词
                </h2>
                <CopyButton text={parsed.slide2} />
              </div>
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                {parsed.slide2}
              </pre>
            </div>
          )}

          {/* Student progress */}
          {parsed?.progress && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  学生进度（Slides 3+）
                </h2>
                <CopyButton text={parsed.progress} />
              </div>
              <div className="space-y-3">
                {parsed.progress.split(/\n\n+/).map((block, i) => (
                  <div key={i} className="text-sm text-slate-700 leading-relaxed border-l-2 border-slate-200 pl-3">
                    <pre className="whitespace-pre-wrap font-sans">{block.trim()}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw fallback */}
          {!parsed?.slide2 && !parsed?.progress && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-700">AI 输出</h2>
                <CopyButton text={cache.content} />
              </div>
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                {cache.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
