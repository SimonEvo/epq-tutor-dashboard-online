import { useState } from 'react'
import { loadFeedback, saveFeedback, type FeedbackItem } from '../store'
import { nid } from '../utils'

interface Props {
  page: string
  onClose: () => void
}

const CATEGORIES = ['功能建议', '体验问题', '没看懂', '其他']

export default function FeedbackPanel({ page, onClose }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>(loadFeedback)
  const [category, setCategory] = useState(CATEGORIES[0])
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(false)

  const submit = () => {
    if (!content.trim()) return
    const next = [
      ...items,
      { id: nid('fb'), page, category, content: content.trim(), createdAt: new Date().toISOString() },
    ]
    setItems(next)
    saveFeedback(next)
    setContent('')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const exportAll = () => {
    navigator.clipboard.writeText(JSON.stringify(items, null, 2))
  }

  return (
    <div className="fb-overlay" onClick={onClose}>
      <div className="fb-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fb-head">
          <h3>💬 内测反馈</h3>
          <button className="del-btn" onClick={onClose}>✕</button>
        </div>
        <p className="muted small">
          反馈会保存在本机浏览器中。体验结束后，请点下方「导出全部」复制 JSON 发给项目负责人，或截图反馈列表。
        </p>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <textarea
          rows={4}
          placeholder={`说说你在「${page}」页面的感受…`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="fb-actions">
          <button className="primary-btn" onClick={submit} disabled={!content.trim()}>
            {saved ? '✓ 已保存' : '提交反馈'}
          </button>
          <button className="ghost-btn" onClick={exportAll} disabled={items.length === 0}>
            导出全部 ({items.length})
          </button>
        </div>
        {items.length > 0 && (
          <div className="fb-list">
            {items
              .slice()
              .reverse()
              .map((f) => (
                <div key={f.id} className="fb-item">
                  <span className="chip">{f.category}</span>
                  <span className="muted small"> {f.page} · </span>
                  {f.content}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
