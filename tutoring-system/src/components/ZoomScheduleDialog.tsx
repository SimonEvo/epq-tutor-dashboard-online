import { useState } from 'react'
import type { SessionRecord } from '@/types'
import { getZoomConfigs, saveMeetingConfigId, getMeetingConfigId, removeMeetingConfigId } from '@/lib/zoomConfig'
import * as dataService from '@/lib/dataService'
import type { ZoomConflict } from '@/lib/dataService'

interface ZoomInfo {
  zoomMeetingId: string
  zoomJoinUrl: string
  zoomPassword: string
}

interface Props {
  session: SessionRecord
  studentName: string
  /** Called when meeting is created or cancelled — pass null to clear */
  onUpdate: (info: ZoomInfo | null) => void
  onClose: () => void
}

export default function ZoomScheduleDialog({ session, studentName, onUpdate, onClose }: Props) {
  const configs = getZoomConfigs()
  const existing = session.zoomMeetingId

  // ── Create-form state ─────────────────────────────────────────────────────
  const normaliseTime = (t?: string) => (t ? t.slice(0, 5) : '09:00')
  const defaultTopic = `${studentName} — ${session.title || session.type.replace('_MEETING', '').replace('_', ' ')} (${session.date})`
  const defaultStartTime = `${session.date}T${normaliseTime(session.time)}`

  const [selectedConfigId, setSelectedConfigId] = useState(configs[0]?.id ?? '')
  const [topic, setTopic] = useState(defaultTopic)
  const [startTime, setStartTime] = useState(defaultStartTime)
  const [duration, setDuration] = useState(session.durationMinutes ?? 60)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [conflicts, setConflicts] = useState<ZoomConflict[]>([])

  // ── Cancel state ──────────────────────────────────────────────────────────
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelWithApi, setCancelWithApi] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  // Look up the config used to create this meeting (stored at creation time)
  const cancelConfig = (() => {
    if (!session.zoomMeetingId) return configs[0]
    const storedId = getMeetingConfigId(session.zoomMeetingId)
    return configs.find(c => c.id === storedId) ?? configs[0]
  })()

  // ── Invite state ──────────────────────────────────────────────────────────
  const [showInvite, setShowInvite] = useState(false)
  const [inviteText, setInviteText] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)

  const selectedConfig = configs.find(c => c.id === selectedConfigId)

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!selectedConfig) return
    setCreating(true)
    setCreateError('')
    setConflicts([])
    try {
      const res = await dataService.createZoomMeeting({
        accountId: selectedConfig.accountId,
        clientId: selectedConfig.clientId,
        clientSecret: selectedConfig.clientSecret,
        topic,
        startTime: startTime + ':00',
        duration,
        timezone: 'Asia/Shanghai',
      })
      saveMeetingConfigId(res.meetingId, selectedConfigId)
      onUpdate({ zoomMeetingId: res.meetingId, zoomJoinUrl: res.joinUrl, zoomPassword: res.password })
    } catch (e) {
      if (e instanceof dataService.ZoomConflictError) {
        setConflicts(e.conflicts)
      } else {
        setCreateError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setCreating(false)
    }
  }

  const handleCancel = async () => {
    setCancelling(true)
    setCancelError('')
    try {
      if (cancelWithApi && cancelConfig && session.zoomMeetingId) {
        await dataService.cancelZoomMeeting(
          session.zoomMeetingId,
          cancelConfig.accountId,
          cancelConfig.clientId,
          cancelConfig.clientSecret,
        )
      }
      if (session.zoomMeetingId) removeMeetingConfigId(session.zoomMeetingId)
      onUpdate(null)
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : String(e))
      setCancelling(false)
    }
  }

  const generateInviteText = () => {
    // "Wednesday, 13 May 2026"
    const dateObj = new Date(session.date + 'T12:00:00')
    const weekday = dateObj.toLocaleDateString('en-GB', { weekday: 'long' })
    const dateStr = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

    // time range
    const startT = (session.time ?? '09:00').slice(0, 5)
    const [h, m] = startT.split(':').map(Number)
    const totalEndMins = h * 60 + m + (session.durationMinutes ?? 60)
    const endH = Math.floor(totalEndMins / 60) % 24
    const endM = totalEndMins % 60
    const endT = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`

    // meeting ID: groups of 3 digits
    const fmtId = (session.zoomMeetingId ?? '').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3')

    const lines: string[] = [
      `Topic       : ${defaultTopic}`,
      `Date & Time : ${weekday}, ${dateStr}, ${startT}–${endT} (BJT)`,
      `Meeting ID  : ${fmtId}`,
    ]
    if (session.zoomPassword) lines.push(`Passcode    : ${session.zoomPassword}`)
    lines.push(`Join URL    : ${session.zoomJoinUrl ?? ''}`)

    return lines.join('\n')
  }

  const handleOpenInvite = () => {
    setInviteText(generateInviteText())
    setShowInvite(true)
  }

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteText)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = inviteText
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2000)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">
              {existing ? 'Zoom 会议已预约' : '预约 Zoom 会议'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{studentName} · {session.date}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {existing ? (
            /* ── View mode: already has a meeting ── */
            <>
              <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 flex flex-col gap-1.5">
                <div className="flex gap-2 text-xs">
                  <span className="text-gray-400 w-16 shrink-0">会议 ID</span>
                  <span className="font-mono text-gray-800 select-all">{session.zoomMeetingId}</span>
                </div>
                {session.zoomPassword && (
                  <div className="flex gap-2 text-xs">
                    <span className="text-gray-400 w-16 shrink-0">密码</span>
                    <span className="font-mono text-gray-800 select-all">{session.zoomPassword}</span>
                  </div>
                )}
                <div className="flex gap-2 text-xs items-start">
                  <span className="text-gray-400 w-16 shrink-0">加入链接</span>
                  <span className="break-all text-teal-700 select-all">{session.zoomJoinUrl}</span>
                </div>
              </div>

              {/* Invite generator */}
              <div className="flex flex-col gap-3">
                {!showInvite ? (
                  <button
                    onClick={handleOpenInvite}
                    className="text-xs px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors self-start"
                  >
                    生成邀请信息
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-600">邀请信息</span>
                      <button
                        onClick={() => setShowInvite(false)}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        收起
                      </button>
                    </div>
                    <textarea
                      value={inviteText}
                      onChange={e => setInviteText(e.target.value)}
                      rows={6}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                    />
                    <button
                      onClick={handleCopyInvite}
                      className="text-xs px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors self-start"
                    >
                      {inviteCopied ? '已复制 ✓' : '复制邀请信息'}
                    </button>
                  </div>
                )}
              </div>

              {/* Cancel section */}
              {!confirmCancel ? (
                <button
                  onClick={() => setConfirmCancel(true)}
                  className="text-xs px-4 py-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors self-start mt-2"
                >
                  取消预约…
                </button>
              ) : (
                <div className="border border-red-200 rounded-xl p-4 flex flex-col gap-3 bg-red-50">
                  <p className="text-xs font-medium text-red-700">确认取消预约？</p>
                  <p className="text-xs text-red-600">本地 Session 里的 Zoom 记录将被清除。</p>

                  {configs.length > 0 && (
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={cancelWithApi}
                        onChange={e => setCancelWithApi(e.target.checked)}
                        className="accent-red-500"
                      />
                      同时通过 Zoom API 删除该会议
                      {cancelWithApi && cancelConfig && (
                        <span className="text-gray-400">（账号：{cancelConfig.name}）</span>
                      )}
                    </label>
                  )}

                  {cancelError && (
                    <p className="text-xs text-red-500">{cancelError}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleCancel}
                      disabled={cancelling}
                      className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 transition-colors"
                    >
                      {cancelling ? '处理中…' : '确认取消'}
                    </button>
                    <button
                      onClick={() => { setConfirmCancel(false); setCancelError('') }}
                      className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-white transition-colors"
                    >
                      返回
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ── Create form ── */
            <>
              {configs.length === 0 ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  尚未配置任何 Zoom 账号。请先前往{' '}
                  <a href="#/zoom-config" className="underline font-medium">Zoom 配置页</a>{' '}
                  添加账号。
                </div>
              ) : (
                <>
                  {/* Account */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600">Zoom 账号</label>
                    <select
                      value={selectedConfigId}
                      onChange={e => { setSelectedConfigId(e.target.value); setConflicts([]) }}
                      className={inputCls}
                    >
                      {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* Topic */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-gray-600">会议主题</label>
                    <input value={topic} onChange={e => setTopic(e.target.value)} className={inputCls} />
                  </div>

                  {/* Start time + Duration */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-gray-600">开始时间</label>
                      <input
                        type="datetime-local"
                        value={startTime}
                        onChange={e => { setStartTime(e.target.value); setConflicts([]) }}
                        className={inputCls}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-gray-600">时长（分钟）</label>
                      <input
                        type="number" min={15} max={480}
                        value={duration}
                        onChange={e => { setDuration(Number(e.target.value)); setConflicts([]) }}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-gray-400">时区：Asia/Shanghai（北京时间）</p>

                  {/* Conflict warning */}
                  {conflicts.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex flex-col gap-1.5">
                      <p className="text-xs font-semibold text-amber-800">该时段与以下会议冲突，无法创建：</p>
                      {conflicts.map((c, i) => (
                        <p key={i} className="text-xs text-amber-700">
                          · {c.topic}（{c.start}–{c.end}）
                        </p>
                      ))}
                    </div>
                  )}

                  {createError && (
                    <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{createError}</div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-200 shrink-0 bg-gray-50">
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-white transition-colors"
          >
            关闭
          </button>
          {!existing && configs.length > 0 && (
            <button
              onClick={handleCreate}
              disabled={creating || !selectedConfig || !topic.trim() || !startTime || conflicts.length > 0}
              className="text-xs px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"
            >
              {creating ? '检查并创建…' : '创建会议'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
