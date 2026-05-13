import { useState } from 'react'
import type { HomeworkEntry, HomeworkItem, SessionRecord } from '@/types'

function parseHomework(raw: string): HomeworkItem[] {
  return raw
    .split('\n')
    .map(line => line.replace(/^[\s]*-\s*/, '').trim())
    .filter(Boolean)
    .map(text => ({ text, done: false }))
}

interface Props {
  session: SessionRecord
  onConfirm: (entry: HomeworkEntry) => void
  onClose: () => void
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export default function HomeworkParseDialog({ session, onConfirm, onClose }: Props) {
  const [items, setItems] = useState<HomeworkItem[]>(() => parseHomework(session.homework))
  const [deadline, setDeadline] = useState('')

  const sourceLabel = `${session.title || session.type.replace('_MEETING', '').replace('_', ' ')} · ${session.date}`

  const updateItem = (idx: number, text: string) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, text } : item))
  }

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const addItem = () => {
    setItems(prev => [...prev, { text: '', done: false }])
  }

  const handleConfirm = () => {
    const validItems = items.filter(i => i.text.trim())
    if (validItems.length === 0) return
    const entry: HomeworkEntry = {
      id: genId(),
      date: session.date,
      sourceLabel,
      sessionId: session.id,
      deadline: deadline || undefined,
      items: validItems,
      comments: '',
      createdAt: new Date().toISOString(),
    }
    onConfirm(entry)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">解析课后作业</h2>
            <p className="text-xs text-gray-400 mt-0.5">{sourceLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Deadline */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 shrink-0">截止日期</label>
            <input
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Items */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-gray-500">作业条目（可编辑）</p>
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-gray-300 text-xs shrink-0 w-5 text-right">{idx + 1}.</span>
                <input
                  value={item.text}
                  onChange={e => updateItem(idx, e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="作业内容…"
                />
                <button
                  onClick={() => removeItem(idx)}
                  className="text-gray-300 hover:text-red-400 transition-colors shrink-0 px-1"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={addItem}
              className="text-xs text-indigo-500 hover:text-indigo-700 self-start mt-1"
            >
              + 添加一项
            </button>
          </div>
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
            disabled={items.filter(i => i.text.trim()).length === 0}
            className="text-xs px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            添加到作业记录
          </button>
        </div>
      </div>
    </div>
  )
}
