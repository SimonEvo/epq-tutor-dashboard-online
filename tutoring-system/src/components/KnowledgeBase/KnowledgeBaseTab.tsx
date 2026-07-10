import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { getSettings } from '@/lib/settings'
import * as dataService from '@/lib/dataService'
import type { ChatMessage, KnowledgeEntry } from '@/lib/dataService'

const SOURCE_BADGE: Record<KnowledgeEntry['source'], { label: string; cls: string }> = {
  manual: { label: '手动', cls: 'bg-gray-100 text-gray-500' },
  wechat: { label: '微信', cls: 'bg-green-100 text-green-600' },
  ai: { label: 'AI', cls: 'bg-purple-100 text-purple-600' },
}

function aiConfig() {
  const { aiApiKey, aiModel, aiBaseUrl } = getSettings()
  return { apiKey: aiApiKey, model: aiModel, baseUrl: aiBaseUrl }
}

const KB_SYSTEM_PROMPT = `你是资深 EPQ（Extended Project Qualification）辅导专家，担任这名学生的私人辅导参谋，只对导师一人服务。

## EPQ 领域知识
- EPQ 是独立研究项目：学生在 TA（教学助理，日常辅导）与 SA（Subject Advisor，学术督导）指导下完成约5000字论文或作品。
- 论文里程碑大致顺序：选题 → 问卷(可选) → Intro → 文综(Literature Review) → 方法论 → 结果 → 讨论 → 反思 → 结语 → 文献 → 摘要；另有官方表格 表1/2/4/5/6/7/11，以及答辩、提交。
- SA 有两条独立红线：会面课次配额、累计时长；两者都要盯。
- 常见卡点：选题过大/不可研究、文综堆砌无批判、方法论与研究问题不匹配、赶 deadline、学生动力不足。遇到相关信号要主动预警。

## 上下文分三层，权重不同
1. **结构化档案** — 客观事实底座（课时、里程碑、日期），最可信但只是事实。
2. **活总结** — 导师对该生的当前理解，是你判断的主要地基。
3. **未消化原料** — 最新、尚未整合的碎片，当作"最新补丁"，优先级最高，可能推翻旧判断。
三层冲突时以更新的信号为准，并明确指出冲突。

## 行为准则
- 先当一个正常、自然的聊天对象。回答的深度和形式跟着导师的问题走：随口一句寒暄或简单提问，就轻松直接地回一句，别硬套结构、别强行分析。只有当导师真的在问分析、规划、诊断、下一步怎么办时，才展开有主见的深入判断。
- 展开分析时才主动、有主见：指出风险、进度异常、被忽略的里程碑、临近的 deadline；下一步落到"做什么 / 为什么 / 怎么做"，让导师能直接照做，不说正确的废话。
- 诚实：信息不足时明说缺什么并向导师反问，绝不编造学生细节或 EPQ 事实。
- 精炼、不啰嗦。只有在内容确实需要分点、分段时才用 Markdown（标题/列表/加粗）；短回答就用大白话，别为了格式而格式。

（注：文中学生姓名为化名，直接使用即可。）`

/** Build the fresh system/context message sent every turn (chat isn't persisted). */
function buildSystemMessage(context: string, summary: string, entries: KnowledgeEntry[]): string {
  const parts = [
    KB_SYSTEM_PROMPT,
    '\n---\n# 一、结构化档案（客观事实）\n' + context,
  ]
  if (summary.trim()) parts.push('\n# 二、活总结（导师当前理解 · 判断地基）\n' + summary)
  const undigested = entries.filter(e => !e.digestedAt)
  if (undigested.length) {
    parts.push('\n# 三、未消化原料（最新补丁 · 优先级最高）\n' + undigested.map(e => `- ${e.content}`).join('\n'))
  }
  return parts.join('\n')
}

export default function KnowledgeBaseTab({ studentId }: { studentId: string; studentName: string }) {
  const [context, setContext] = useState('')
  const [charCount, setCharCount] = useState(0)
  const [summary, setSummary] = useState('')
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState('')
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // chat — cached per student in sessionStorage so it survives tab switches /
  // navigation / reload within the browser session. Cleared only on 清空 or
  // after a digest lands (see confirmMerge); NOT cleared by leaving the tab.
  const chatCacheKey = `kb-chat-${studentId}`
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = sessionStorage.getItem(`kb-chat-${studentId}`)
      return raw ? JSON.parse(raw) as ChatMessage[] : []
    } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // living summary editing
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(true)

  // raw inbox
  const [newEntry, setNewEntry] = useState('')
  const [newSource, setNewSource] = useState<KnowledgeEntry['source']>('manual')
  const [showDigested, setShowDigested] = useState(false)

  // digest flow
  const [digesting, setDigesting] = useState(false)
  const [proposals, setProposals] = useState<{ text: string; checked: boolean }[] | null>(null)
  const [digestEntryIds, setDigestEntryIds] = useState<string[]>([])
  const [mergePreview, setMergePreview] = useState<{ merged: string; previous: string } | null>(null)
  const [merging, setMerging] = useState(false)

  const reloadEntries = useCallback(async () => {
    setEntries(await dataService.getKnowledgeEntries(studentId, true))
  }, [studentId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      dataService.getKbContext(studentId),
      dataService.getLivingSummary(studentId),
      dataService.getKnowledgeEntries(studentId, true),
    ]).then(([ctx, sum, ents]) => {
      if (cancelled) return
      setContext(ctx.context); setCharCount(ctx.charCount)
      setSummary(sum.content); setSummaryUpdatedAt(sum.updatedAt)
      setEntries(ents)
      setLoading(false)
    }).catch(e => { if (!cancelled) { setError(String(e.message || e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [studentId])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, sending])

  // Persist chat to the per-student cache on every change; empty = drop the key.
  useEffect(() => {
    try {
      if (messages.length) sessionStorage.setItem(chatCacheKey, JSON.stringify(messages))
      else sessionStorage.removeItem(chatCacheKey)
    } catch { /* storage full / disabled — non-fatal */ }
  }, [messages, chatCacheKey])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    const cfg = aiConfig()
    if (!cfg.apiKey) { setError('请先在设置页面填写 API Key'); return }
    setError('')
    const nextConversation: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(nextConversation)
    setInput('')
    setSending(true)
    try {
      const system: ChatMessage = { role: 'system', content: buildSystemMessage(context, summary, entries) }
      const { content } = await dataService.kbChat(studentId, [system, ...nextConversation], cfg)
      setMessages([...nextConversation, { role: 'assistant', content }])
    } catch (e) {
      setError(String((e as Error).message || e))
      setMessages(nextConversation)  // keep the user turn; let them retry
    } finally {
      setSending(false)
    }
  }

  const addEntry = async () => {
    const text = newEntry.trim()
    if (!text) return
    await dataService.addKnowledgeEntry(studentId, text, newSource)
    setNewEntry('')
    await reloadEntries()
  }

  const removeEntry = async (id: string) => {
    await dataService.deleteKnowledgeEntry(studentId, id)
    await reloadEntries()
  }

  const saveSummary = async () => {
    const res = await dataService.putLivingSummary(studentId, summaryDraft)
    setSummary(res.content); setSummaryUpdatedAt(res.updatedAt)
    setEditingSummary(false)
  }

  const runDigest = async () => {
    const cfg = aiConfig()
    if (!cfg.apiKey) { setError('请先在设置页面填写 API Key'); return }
    setError(''); setDigesting(true)
    try {
      const conversation = messages.filter(m => m.role !== 'system')
      const res = await dataService.kbDigest(studentId, conversation, cfg)
      if (res.rawReply) { setError('消化提议解析失败，AI 原文：' + res.rawReply); return }
      setProposals(res.proposals.map(text => ({ text, checked: true })))
      setDigestEntryIds(res.entryIds)
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setDigesting(false)
    }
  }

  const runMerge = async () => {
    if (!proposals) return
    const approved = proposals.filter(p => p.checked).map(p => p.text.trim()).filter(Boolean)
    if (!approved.length) { setProposals(null); return }
    const cfg = aiConfig()
    setMerging(true); setError('')
    try {
      const res = await dataService.kbMerge(studentId, approved, cfg)
      setMergePreview(res)
      setProposals(null)
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setMerging(false)
    }
  }

  const confirmMerge = async () => {
    if (!mergePreview) return
    const res = await dataService.putLivingSummary(studentId, mergePreview.merged, digestEntryIds)
    setSummary(res.content); setSummaryUpdatedAt(res.updatedAt)
    setMergePreview(null); setDigestEntryIds([])
    setMessages([])  // digest has landed into the Living Summary — clear the ephemeral chat
    await reloadEntries()
  }

  if (loading) return <div className="text-sm text-gray-400 py-10 text-center">加载知识库…</div>

  const visibleEntries = entries.filter(e => showDigested || !e.digestedAt)
  const undigestedCount = entries.filter(e => !e.digestedAt).length

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {error && (
        <div className="lg:col-span-3 text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* ── Chat panel (main) ── */}
      <div className="lg:col-span-2 flex flex-col border border-gray-200 rounded-xl bg-white min-h-[520px]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-900">对话</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300">上下文 {charCount} 字</span>
            <button onClick={runDigest} disabled={digesting || messages.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg border border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary-bg)] disabled:opacity-40">
              {digesting ? '消化中…' : '消化 / 更新活总结'}
            </button>
            <button onClick={() => setMessages([])} disabled={messages.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
              清空
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-300 text-center py-16">
              向 AI 提问，规划这名学生的下一步辅导。<br />上下文已自动装配（档案 + 活总结 + 未消化原料）。
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'bg-[var(--primary)] text-white'
                  : 'bg-gray-50 text-gray-800 prose prose-sm max-w-none'}`}>
                {m.role === 'user'
                  ? <span className="whitespace-pre-wrap">{m.content}</span>
                  : <ReactMarkdown>{m.content}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {sending && <div className="text-xs text-gray-400 animate-pulse">AI 思考中…</div>}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-gray-100 p-3 flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            rows={2}
            placeholder="提问…（Cmd/Ctrl+Enter 发送）"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
          />
          <button onClick={send} disabled={sending || !input.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-40">
            发送
          </button>
        </div>
      </div>

      {/* ── Side column: living summary + raw inbox ── */}
      <div className="space-y-5">
        {/* Living summary */}
        <div className="border border-gray-200 rounded-xl bg-white">
          <button onClick={() => setSummaryOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <span className="text-sm font-medium text-gray-900">活总结</span>
            <span className="text-xs text-gray-300">{summaryOpen ? '收起 ▾' : '展开 ▸'}</span>
          </button>
          {summaryOpen && (
            <div className="p-4">
              {editingSummary ? (
                <div className="space-y-2">
                  <textarea value={summaryDraft} onChange={e => setSummaryDraft(e.target.value)} rows={10}
                    className="w-full text-sm border border-[var(--primary)] rounded-lg px-3 py-2 focus:outline-none resize-y" />
                  <div className="flex gap-2">
                    <button onClick={saveSummary} className="text-xs px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg">保存</button>
                    <button onClick={() => setEditingSummary(false)} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg">取消</button>
                  </div>
                </div>
              ) : (
                <>
                  {summary.trim()
                    ? <div className="prose prose-sm max-w-none text-gray-700"><ReactMarkdown>{summary}</ReactMarkdown></div>
                    : <p className="text-sm text-gray-300">尚无活总结。对话后点「消化」生成。</p>}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-gray-300">{summaryUpdatedAt ? new Date(summaryUpdatedAt).toLocaleString('zh-CN') : ''}</span>
                    <button onClick={() => { setSummaryDraft(summary); setEditingSummary(true) }}
                      className="text-xs text-gray-400 hover:text-gray-600">编辑</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Raw inbox */}
        <div className="border border-gray-200 rounded-xl bg-white">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <span className="text-sm font-medium text-gray-900">原料收件箱</span>
            <button onClick={() => setShowDigested(s => !s)} className="text-xs text-gray-400 hover:text-gray-600">
              {showDigested ? '仅未消化' : `全部（含已归档）`}
            </button>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex gap-2 items-end">
              <textarea value={newEntry} onChange={e => setNewEntry(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addEntry() } }}
                rows={2}
                placeholder="随手记一条…（Cmd/Ctrl+Enter 保存）"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none" />
              <div className="flex flex-col gap-1.5">
                <select value={newSource} onChange={e => setNewSource(e.target.value as KnowledgeEntry['source'])}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1">
                  <option value="manual">手动</option>
                  <option value="wechat">微信</option>
                </select>
                <button onClick={addEntry} className="text-sm py-1 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]">+ 添加</button>
              </div>
            </div>
            <p className="text-xs text-gray-300">{undigestedCount} 条未消化</p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {visibleEntries.length === 0 && <p className="text-sm text-gray-300 py-4 text-center">暂无原料</p>}
              {visibleEntries.map(e => {
                const badge = SOURCE_BADGE[e.source]
                return (
                  <div key={e.id} className={`group flex items-start gap-2 text-sm rounded-lg px-2.5 py-1.5 ${e.digestedAt ? 'bg-gray-50 text-gray-400' : 'bg-white border border-gray-100'}`}>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                    <span className="flex-1 whitespace-pre-wrap">{e.content}</span>
                    {e.digestedAt
                      ? <span className="shrink-0 text-[10px] text-gray-300">已归档</span>
                      : <button onClick={() => removeEntry(e.id)} className="shrink-0 text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-400">✕</button>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Digest proposals modal ── */}
      {proposals && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setProposals(null)}>
          <div className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium text-gray-900 mb-1">AI 提议的耐久事实</h3>
            <p className="text-xs text-gray-400 mb-3">勾选要纳入活总结的条目，可编辑文字。批准后合并。</p>
            {proposals.length === 0 && <p className="text-sm text-gray-400 py-4">AI 未提出新事实。</p>}
            <div className="space-y-2">
              {proposals.map((p, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input type="checkbox" checked={p.checked} className="mt-2"
                    onChange={() => setProposals(ps => ps!.map((x, j) => j === i ? { ...x, checked: !x.checked } : x))} />
                  <textarea value={p.text} rows={2}
                    onChange={e => setProposals(ps => ps!.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[var(--primary)]" />
                  <button onClick={() => setProposals(ps => ps!.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-400 mt-1.5">✕</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setProposals(null)} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">取消</button>
              <button onClick={runMerge} disabled={merging || proposals.every(p => !p.checked)}
                className="text-sm px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-40">
                {merging ? '合并中…' : '批准并合并'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Merge preview modal ── */}
      {mergePreview && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setMergePreview(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium text-gray-900 mb-1">活总结更新预览</h3>
            <p className="text-xs text-gray-400 mb-3">确认后落地，被纳入的原料条目将归档。</p>
            <div className="prose prose-sm max-w-none text-gray-700 border border-gray-100 rounded-lg p-3 bg-gray-50">
              <ReactMarkdown>{mergePreview.merged}</ReactMarkdown>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setMergePreview(null)} className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">取消</button>
              <button onClick={confirmMerge} className="text-sm px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]">确认落地</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
