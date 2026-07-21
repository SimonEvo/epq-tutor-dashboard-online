import { useState } from 'react'
import { useStudentStore } from '@/stores/studentStore'
import * as dataService from '@/lib/dataService'
import { rankNagMarkdown } from '@/lib/claudeService'
import { copyToClipboard } from '@/lib/formatters'
import type { NagPreview, NagPushResult } from '@/types'

function pushSummary(r: NagPushResult): string {
  if (r.push.skipped) return '未推送：' + (r.push.errors[0] || 'webhook 未配置')
  const base = `成功 ${r.push.sent} 条` + (r.push.failed ? `，失败 ${r.push.failed} 条` : '')
  return r.push.errors.length ? `${base}（${r.push.errors.join('；')}）` : base
}

export default function NagCenter() {
  const { students } = useStudentStore()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<NagPreview | null>(null)

  const [aiLoading, setAiLoading] = useState(false)
  const [aiMarkdown, setAiMarkdown] = useState('')

  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState('')

  const reset = () => { setPreview(null); setError(''); setAiMarkdown(''); setPushMsg('') }

  const handleScan = async () => {
    setLoading(true)
    reset()
    try {
      setPreview(await dataService.nagPreview())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleAiRank = async () => {
    if (!preview) return
    setAiLoading(true)
    setError('')
    setPushMsg('')
    try {
      setAiMarkdown(await rankNagMarkdown(preview.scan, students))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  const handleSend = async (content?: string) => {
    setPushing(true)
    setPushMsg('')
    setError('')
    try {
      setPushMsg(pushSummary(await dataService.nagSend(content)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPushing(false)
    }
  }

  const scan = preview?.scan
  const g = scan?.groups
  const nothing = scan && scan.total === 0

  return (
    <div className="mb-6">
      <button
        onClick={() => { setOpen(o => !o); reset() }}
        className={`text-sm px-4 py-2 rounded-lg border transition-colors ${
          open ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
        }`}
      >
        📣 群催促
      </button>

      {open && (
        <div className="mt-3 bg-white rounded-2xl border border-gray-200 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleScan}
              disabled={loading}
              className="text-sm px-4 py-2 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-40 transition-colors"
            >
              {loading ? '扫描中…' : '扫描今日'}
            </button>
            {preview && (
              <span className={`text-xs px-2 py-1 rounded ${preview.webhookConfigured ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50'}`}>
                {preview.webhookConfigured ? 'Webhook 已配置' : 'Webhook 未配置（推送会被跳过）'}
              </span>
            )}
          </div>

          <p className="text-xs text-gray-400">
            每工作日早 9:00 自动推送规则版。这里可手动扫描、预览、立即推送，或用 AI 排轻重缓急后再推。
          </p>

          {error && <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</div>}
          {pushMsg && <div className="text-xs text-green-600 bg-green-50 border border-green-100 rounded-xl px-3 py-2">{pushMsg} ✓</div>}

          {nothing && (
            <div className="text-sm text-gray-400 text-center py-8">今日无需催促的学生 🎉（自动推送时也不会发消息）</div>
          )}

          {scan && g && !nothing && (
            <div className="flex flex-col gap-4">
              {/* 分组预览 */}
              <div className="border border-[var(--border)] bg-[var(--primary-bg)] rounded-xl p-4 flex flex-col gap-3 text-xs">
                <p className="font-semibold text-[var(--primary-hover)]">
                  {scan.date} {scan.weekday} · 共 {scan.total} 项
                </p>

                {g.unscheduled_sa.length > 0 && (
                  <NagGroup title={`📌 未预约下次 SA（${g.unscheduled_sa.length}）`}
                    rows={g.unscheduled_sa.map(x => ({ name: x.name, topic: x.topic, status: '尚未预约' }))} />
                )}
                {g.stale.length > 0 && (
                  <NagGroup title={`🐢 停滞未更新 >${scan.stale_threshold}天（${g.stale.length}）`}
                    rows={g.stale.map(x => ({ name: x.name, topic: x.topic, status: x.stale_days == null ? '从无记录' : `已 ${x.stale_days} 天无进度` }))} />
                )}
                {g.upcoming_sa.length > 0 && (
                  <NagGroup title={`⏰ 临近 SA（${g.upcoming_sa.length}）`}
                    rows={g.upcoming_sa.map(x => ({ name: x.name, topic: x.topic, status: `下次 SA ${x.when}` }))} />
                )}
                {scan.events.length > 0 && (
                  <NagGroup title={`📅 临近日程（${scan.events.length}）`}
                    rows={scan.events.map(x => ({ name: x.title, topic: '', status: x.when }))} />
                )}
              </div>

              {/* 操作 */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleSend()}
                  disabled={pushing}
                  className="text-sm px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-40 transition-colors"
                >
                  {pushing ? '推送中…' : '推送规则版'}
                </button>
                <button
                  onClick={handleAiRank}
                  disabled={aiLoading}
                  className="text-sm px-4 py-1.5 border border-[var(--primary)] text-[var(--primary)] rounded-lg hover:bg-[var(--primary-bg)] disabled:opacity-40 transition-colors"
                >
                  {aiLoading ? 'AI 排序中…' : '✦ AI 排轻重缓急'}
                </button>
                {preview && preview.messages.length > 1 && (
                  <span className="text-xs text-gray-400 self-center">规则版将分 {preview.messages.length} 条发送</span>
                )}
              </div>

              {/* AI 版可编辑预览 */}
              {aiMarkdown && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-gray-400">AI 排序版（可手动编辑后再推送）：</p>
                  <textarea
                    value={aiMarkdown}
                    onChange={e => setAiMarkdown(e.target.value)}
                    rows={12}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-y"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSend(aiMarkdown)}
                      disabled={pushing || !aiMarkdown.trim()}
                      className="text-sm px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-40 transition-colors"
                    >
                      {pushing ? '推送中…' : '推送此版本'}
                    </button>
                    <button
                      onClick={() => copyToClipboard(aiMarkdown)}
                      className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      复制
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NagGroup({ title, rows }: { title: string; rows: { name: string; topic: string; status: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold text-gray-700">{title}</p>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 pl-2">
          <span className="text-gray-800 font-medium shrink-0">{r.name}</span>
          {r.topic && <span className="text-gray-400 truncate">{r.topic}</span>}
          <span className="text-amber-600 shrink-0 ml-auto">{r.status}</span>
        </div>
      ))}
    </div>
  )
}
