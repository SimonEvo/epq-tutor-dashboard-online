import { useState } from 'react'
import { createScheduleEvent, updateScheduleEvent, deleteScheduleEvent } from '@/lib/dataService'
import type { ScheduleEvent } from '@/types'

/**
 * Lightweight editor for a 日程事件 (non-teaching meeting) shown from the week
 * schedule view. Handles both create (from an empty slot, prefilled date/time)
 * and edit. Start time is mandatory — no timeless meetings, same rule as sessions.
 */

interface Props {
  event?: ScheduleEvent | null          // present = edit; absent = create
  prefill?: { date: string; time: string }
  onClose: () => void
  onSaved: () => void
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export default function QuickEventEditPopover({ event, prefill, onClose, onSaved }: Props) {
  const isEdit = !!event
  const [title, setTitle] = useState(event?.title ?? '')
  const [date, setDate] = useState(event?.date ?? prefill?.date ?? new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState(event?.time ?? prefill?.time ?? '')
  const [duration, setDuration] = useState<number | ''>(event?.durationMinutes ?? 60)
  const [note, setNote] = useState(event?.note ?? '')
  const [link, setLink] = useState(event?.link ?? '')
  const [countsAsOvertime, setCountsAsOvertime] = useState(event?.countsAsOvertime ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    if (!time) {
      setError('请填写起始时间——没有起始时间的会议不能创建')
      return
    }
    if (!title.trim()) {
      setError('请填写标题')
      return
    }
    setSaving(true)
    try {
      const payload: ScheduleEvent = {
        id: event?.id ?? generateId(),
        title: title.trim(),
        date,
        time,
        durationMinutes: duration === '' ? 0 : duration,
        note: note.trim(),
        link: link.trim(),
        countsAsOvertime,
        createdAt: event?.createdAt ?? '',
        updatedAt: event?.updatedAt ?? '',
      }
      if (isEdit) await updateScheduleEvent(payload)
      else await createScheduleEvent(payload)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!event) return
    if (!window.confirm('删除这个日程事件？')) return
    setSaving(true)
    setError('')
    try {
      await deleteScheduleEvent(event.id)
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
          <h2 className="font-semibold text-gray-900 text-sm">{isEdit ? '编辑日程事件' : '新建日程事件'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div>
            <label className="block text-xs text-gray-500 mb-1">标题 <span className="text-red-500">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={countsAsOvertime ? '如：教研例会' : '如：陪娃看牙'}
              className={inputCls} autoFocus />
          </div>

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

          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={countsAsOvertime}
              onChange={e => setCountsAsOvertime(e.target.checked)}
              className="w-4 h-4 accent-[var(--primary)]" />
            算加班（非学生会议的加班项目，进「加班申请」统计）
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 bg-[var(--primary)] text-white text-sm py-2 rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors">
              {saving ? '保存中…' : '保存'}
            </button>
            {isEdit && (
              <button type="button" onClick={handleDelete} disabled={saving}
                className="text-sm py-2 px-3 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors">
                删除
              </button>
            )}
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
