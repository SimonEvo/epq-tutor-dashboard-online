import { useState } from 'react'
import { updateGroupClass, deleteGroupClass } from '@/lib/dataService'
import type { GroupClass } from '@/types'

/**
 * 团课的快速编辑，从周日程点块打开。团课不绑学生，所以这里没有学生选择器——
 * 参与名单是自由文本，等将来对接公共教务系统再换结构化数据。
 */

interface Props {
  groupClass: GroupClass
  onClose: () => void
  onSaved: () => void
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

export default function QuickGroupClassEditPopover({ groupClass, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(groupClass.title)
  const [date, setDate] = useState(groupClass.date)
  const [time, setTime] = useState(groupClass.time)
  const [duration, setDuration] = useState<number | ''>(groupClass.durationMinutes)
  const [roster, setRoster] = useState(groupClass.roster)
  const [note, setNote] = useState(groupClass.note)
  const [link, setLink] = useState(groupClass.link)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setError('')
    if (!date) { setError('请填写日期'); return }
    if (!time) { setError('请填写起始时间——没有起始时间的团课不能保存'); return }
    if (!title.trim()) { setError('请填写课程标题'); return }
    setSaving(true)
    try {
      await updateGroupClass({
        ...groupClass,
        title: title.trim(),
        date,
        time,
        durationMinutes: duration === '' ? 0 : duration,
        roster: roster.trim(),
        note: note.trim(),
        link: link.trim(),
      })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`删除团课「${groupClass.title}」？`)) return
    setSaving(true)
    setError('')
    try {
      await deleteGroupClass(groupClass.id)
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
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">编辑团课</h2>
            <p className="text-xs text-gray-400 mt-0.5">一对多理论课 · 不绑学生 · 计入加班申请</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div>
            <label className="block text-xs text-gray-500 mb-1">课程标题 <span className="text-red-500">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="如：EPQ 方法论公开课" className={inputCls} autoFocus />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">日期 <span className="text-red-500">*</span></label>
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
            <label className="block text-xs text-gray-500 mb-1">参与名单</label>
            <textarea value={roster} onChange={e => setRoster(e.target.value)} rows={2}
              placeholder="自由填，如：张三、李四、王五（外校 2 人）" className={inputCls} />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">链接</label>
            <input value={link} onChange={e => setLink(e.target.value)}
              placeholder="会议链接（腾讯会议/Zoom…）" className={inputCls} />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">备注</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="可选" className={inputCls} />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 bg-[var(--primary)] text-white text-sm py-2 rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors">
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={handleDelete} disabled={saving}
              className="text-sm py-2 px-3 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors">
              删除
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
