import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getZoomConfigs,
  addZoomConfig,
  updateZoomConfig,
  deleteZoomConfig,
  type ZoomConfig,
} from '@/lib/zoomConfig'

const EMPTY_FORM = { name: '', accountId: '', clientId: '', clientSecret: '' }

export default function ZoomConfigPage() {
  const [configs, setConfigs] = useState<ZoomConfig[]>(getZoomConfigs)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [addDraft, setAddDraft] = useState(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const refresh = () => setConfigs(getZoomConfigs())

  const handleStartEdit = (cfg: ZoomConfig) => {
    setEditingId(cfg.id)
    setEditDraft({ name: cfg.name, accountId: cfg.accountId, clientId: cfg.clientId, clientSecret: cfg.clientSecret })
  }

  const handleSaveEdit = (id: string) => {
    if (!editDraft.name.trim() || !editDraft.accountId.trim() || !editDraft.clientId.trim() || !editDraft.clientSecret.trim()) return
    updateZoomConfig(id, editDraft)
    setEditingId(null)
    refresh()
  }

  const handleAdd = () => {
    if (!addDraft.name.trim() || !addDraft.accountId.trim() || !addDraft.clientId.trim() || !addDraft.clientSecret.trim()) return
    addZoomConfig(addDraft)
    setAddDraft(EMPTY_FORM)
    setAdding(false)
    refresh()
  }

  const handleDelete = (id: string) => {
    deleteZoomConfig(id)
    setConfirmDelete(null)
    refresh()
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/settings" className="text-gray-400 hover:text-gray-600 text-sm">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">Zoom 账号配置</h1>
      </div>

      <p className="text-sm text-gray-500 mb-5">
        配置 Zoom Server-to-Server OAuth 凭据，用于 API 拉取会议记录和预约会议。
        凭据保存在浏览器本地，不存储于服务器，仅在调用时随请求发送。
        <br />
        申请入口：<span className="font-mono text-xs bg-gray-100 px-1 rounded">Zoom App Marketplace → Build App → Server-to-Server OAuth</span>
      </p>

      {/* Config list */}
      <div className="flex flex-col gap-3 mb-4">
        {configs.length === 0 && !adding && (
          <div className="text-center py-8 text-gray-400 text-sm bg-white rounded-2xl border border-dashed border-gray-200">
            暂无 Zoom 账号配置。点击下方"添加账号"开始配置。
          </div>
        )}

        {configs.map(cfg => (
          <div key={cfg.id} className="bg-white rounded-2xl border border-gray-200 p-5">
            {editingId === cfg.id ? (
              <ConfigForm
                draft={editDraft}
                setDraft={setEditDraft}
                onSave={() => handleSaveEdit(cfg.id)}
                onCancel={() => setEditingId(null)}
                saveLabel="保存修改"
              />
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <p className="font-semibold text-gray-900 text-sm">{cfg.name}</p>
                  <p className="text-xs text-gray-400 font-mono">Account ID: {cfg.accountId}</p>
                  <p className="text-xs text-gray-400 font-mono">Client ID: {cfg.clientId}</p>
                  <p className="text-xs text-gray-400 font-mono">Secret: {'•'.repeat(12)}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleStartEdit(cfg)}
                    className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    编辑
                  </button>
                  {confirmDelete === cfg.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(cfg.id)}
                        className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                      >
                        确认删除
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(cfg.id)}
                      className="text-xs px-3 py-1.5 border border-red-200 text-red-400 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add new form */}
        {adding && (
          <div className="bg-white rounded-2xl border border-indigo-200 p-5">
            <p className="text-xs font-semibold text-indigo-700 mb-3">新账号</p>
            <ConfigForm
              draft={addDraft}
              setDraft={setAddDraft}
              onSave={handleAdd}
              onCancel={() => { setAdding(false); setAddDraft(EMPTY_FORM) }}
              saveLabel="添加"
            />
          </div>
        )}
      </div>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 添加账号
        </button>
      )}
    </div>
  )
}

// ── Shared form ───────────────────────────────────────────────────────────────

interface FormDraft { name: string; accountId: string; clientId: string; clientSecret: string }

function ConfigForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  saveLabel,
}: {
  draft: FormDraft
  setDraft: (d: FormDraft) => void
  onSave: () => void
  onCancel: () => void
  saveLabel: string
}) {
  const valid = draft.name.trim() && draft.accountId.trim() && draft.clientId.trim() && draft.clientSecret.trim()
  return (
    <div className="flex flex-col gap-3">
      <Field label="账号名称 *">
        <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. 主账号 / 教学账号" className={inputCls} />
      </Field>
      <Field label="Account ID *">
        <input value={draft.accountId} onChange={e => setDraft({ ...draft, accountId: e.target.value })}
          placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
      </Field>
      <Field label="Client ID *">
        <input value={draft.clientId} onChange={e => setDraft({ ...draft, clientId: e.target.value })}
          placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
      </Field>
      <Field label="Client Secret *">
        <input type="password" value={draft.clientSecret} onChange={e => setDraft({ ...draft, clientSecret: e.target.value })}
          placeholder="••••••••••••••••••••••••" className={inputCls} />
      </Field>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={!valid}
          className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors">
          {saveLabel}
        </button>
        <button onClick={onCancel}
          className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          取消
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
