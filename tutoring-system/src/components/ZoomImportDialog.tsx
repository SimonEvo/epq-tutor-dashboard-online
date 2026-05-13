import { useState } from 'react'
import type { SessionRecord } from '@/types'
import { getZoomConfigs } from '@/lib/zoomConfig'
import * as dataService from '@/lib/dataService'

// ── Parser ────────────────────────────────────────────────────────────────────

type ParsedFields = { summary: string; transcript: string; homework: string }

const SECTION_MAP: Record<string, keyof ParsedFields> = {
  'quick recap': 'summary',
  'summary': 'transcript',
  'next steps': 'homework',
  'action items': 'homework',
}

function parseZoomRecap(text: string): ParsedFields {
  const result: ParsedFields = { summary: '', transcript: '', homework: '' }
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const buf: Partial<Record<keyof ParsedFields, string[]>> = {}
  let cur: keyof ParsedFields | null = null

  for (const line of lines) {
    const bare = line.replace(/^#+\s*/, '').trim()
    const field = SECTION_MAP[bare.toLowerCase()]
    if (field !== undefined) {
      cur = field
      if (!buf[cur]) buf[cur] = []
    } else if (cur) {
      buf[cur]!.push(line)
    }
  }

  for (const [field, lines] of Object.entries(buf) as [keyof ParsedFields, string[]][]) {
    result[field] = lines.join('\n').trim()
  }
  return result
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  session: SessionRecord
  onConfirm: (updates: Partial<Pick<SessionRecord, 'summary' | 'homework' | 'transcript'>>) => void
  onClose: () => void
}

export default function ZoomImportDialog({ session, onConfirm, onClose }: Props) {
  const configs = getZoomConfigs()
  const [selectedConfigId, setSelectedConfigId] = useState(configs[0]?.id ?? '')
  const [rawText, setRawText] = useState('')
  const [meetingId, setMeetingId] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [parsed, setParsed] = useState<ParsedFields | null>(null)

  const selectedConfig = configs.find(c => c.id === selectedConfigId)
  const sessionLabel = `${session.title || session.type.replace('_MEETING', '').replace('_', ' ')} · ${session.date}`

  const handleTextChange = (val: string) => {
    setRawText(val)
    setParsed(null)
  }

  const handleParse = () => {
    if (!rawText.trim()) return
    setParsed(parseZoomRecap(rawText))
  }

  const handleFetchZoom = async () => {
    if (!meetingId.trim() || !selectedConfig) return
    setFetching(true)
    setFetchError('')
    try {
      const result = await dataService.fetchZoomMeetingSummary(
        meetingId.trim(),
        selectedConfig.accountId,
        selectedConfig.clientId,
        selectedConfig.clientSecret,
      )
      const content = result.summary_content
      setRawText(content)
      setParsed(parseZoomRecap(content))
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e))
    } finally {
      setFetching(false)
    }
  }

  const handleConfirm = () => {
    if (!parsed) return
    const updates: Partial<Pick<SessionRecord, 'summary' | 'homework' | 'transcript'>> = {}
    if (parsed.summary)    updates.summary    = parsed.summary
    if (parsed.transcript) updates.transcript = parsed.transcript
    if (parsed.homework)   updates.homework   = parsed.homework
    onConfirm(updates)
  }

  const hasContent = parsed && (parsed.summary || parsed.transcript || parsed.homework)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">导入 Zoom 会议记录</h2>
            <p className="text-xs text-gray-400 mt-0.5">{sessionLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* API fetch row */}
          {configs.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              {configs.length > 1 && (
                <select
                  value={selectedConfigId}
                  onChange={e => setSelectedConfigId(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <input
                value={meetingId}
                onChange={e => setMeetingId(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFetchZoom() }}
                placeholder="Zoom 会议 ID（数字）"
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={handleFetchZoom}
                disabled={fetching || !meetingId.trim()}
                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors shrink-0"
              >
                {fetching ? '拉取中…' : '从 Zoom API 拉取'}
              </button>
            </div>
          ) : (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              未配置 Zoom 账号，暂不支持 API 拉取。可在{' '}
              <a href="#/zoom-config" className="underline font-medium">Zoom 配置页</a>{' '}
              添加账号后使用。
            </div>
          )}

          {fetchError && (
            <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fetchError}</div>
          )}

          {/* Paste area */}
          <div>
            <p className="text-xs text-gray-500 mb-1.5">
              或直接粘贴 Zoom Quick Recap 内容（支持 <code className="bg-gray-100 px-1 rounded">## Quick Recap</code> 等标题格式）：
            </p>
            <textarea
              value={rawText}
              onChange={e => handleTextChange(e.target.value)}
              rows={9}
              placeholder={"## Quick Recap\n会议概述…\n\n## Summary\n详细讨论内容…\n\n## Next Steps\n- 下节课作业 1\n- 下节课作业 2"}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
          </div>

          <button
            onClick={handleParse}
            disabled={!rawText.trim()}
            className="text-xs px-4 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-40 transition-colors self-start"
          >
            解析内容
          </button>

          {/* Parsed preview */}
          {parsed && (
            <div className="border border-indigo-100 bg-indigo-50 rounded-xl p-4 flex flex-col gap-3">
              <p className="text-xs font-semibold text-indigo-700">解析结果预览</p>
              {parsed.summary   && <PreviewField label="Quick Recap → Summary（课程概要）"     value={parsed.summary} />}
              {parsed.transcript && <PreviewField label="Summary → Transcript（完整记录）"      value={parsed.transcript} clamp />}
              {parsed.homework  && <PreviewField label="Next Steps → Homework（作业/下一步）"   value={parsed.homework} />}
              {!hasContent && (
                <p className="text-xs text-gray-500">
                  未识别到任何章节。请确认内容包含 <strong>Quick Recap</strong> / <strong>Summary</strong> / <strong>Next Steps</strong> 等标题。
                </p>
              )}
            </div>
          )}

          {hasContent && (session.summary || session.transcript || session.homework) && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              该 Session 已有部分内容，确认导入后将覆盖对应字段。
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-200 shrink-0 bg-gray-50">
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!hasContent}
            className="text-xs px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            确认导入
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewField({ label, value, clamp }: { label: string; value: string; clamp?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xs text-gray-700 bg-white rounded-lg p-2 border border-indigo-100 whitespace-pre-wrap leading-relaxed ${clamp ? 'line-clamp-5' : ''}`}>
        {value}
      </p>
    </div>
  )
}
