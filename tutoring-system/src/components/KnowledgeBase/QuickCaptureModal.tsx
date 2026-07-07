import { useEffect, useMemo, useState } from 'react'
import { useStudentStore } from '@/stores/studentStore'
import * as dataService from '@/lib/dataService'
import type { KnowledgeEntry } from '@/lib/dataService'

/**
 * Global quick-capture: pick a student + jot one line -> a manual/wechat raw
 * Knowledge Entry. Two steps, available anywhere via the sidebar. This is the
 * key to low-friction capture (pain c) since scraps arise mid-/post-class or
 * while reading WeChat, when the tutor isn't on that student's detail page.
 */
export default function QuickCaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { students, fetchAll } = useStudentStore()
  const [studentId, setStudentId] = useState('')
  const [content, setContent] = useState('')
  const [source, setSource] = useState<KnowledgeEntry['source']>('manual')
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && students.length === 0) fetchAll()
  }, [open, students.length, fetchAll])

  useEffect(() => {
    if (open) { setContent(''); setSavedName(''); setError('') }
  }, [open])

  const sorted = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    [students],
  )

  if (!open) return null

  const save = async () => {
    if (!studentId) { setError('请选择学生'); return }
    const text = content.trim()
    if (!text) { setError('请输入内容'); return }
    setSaving(true); setError('')
    try {
      await dataService.addKnowledgeEntry(studentId, text, source)
      const name = students.find(s => s.id === studentId)?.name || ''
      setSavedName(name)
      setContent('')
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 pt-24" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900">速记</h3>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600">✕</button>
        </div>

        {savedName && (
          <div className="text-xs text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">
            已存入「{savedName}」的原料收件箱。可继续记录或关闭。
          </div>
        )}
        {error && (
          <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>
        )}

        <div className="space-y-2.5">
          <select
            value={studentId}
            onChange={e => setStudentId(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          >
            <option value="">选择学生…</option>
            {sorted.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.nameEn ? ` (${s.nameEn})` : ''}</option>
            ))}
          </select>

          <textarea
            autoFocus
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() } }}
            rows={3}
            placeholder="一句话记录…（Cmd/Ctrl+Enter 保存）"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
          />

          <div className="flex items-center justify-between">
            <select
              value={source}
              onChange={e => setSource(e.target.value as KnowledgeEntry['source'])}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5"
            >
              <option value="manual">手动</option>
              <option value="wechat">微信</option>
            </select>
            <button
              onClick={save}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
