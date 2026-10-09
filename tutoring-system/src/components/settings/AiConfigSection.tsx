import { useEffect, useState } from 'react'
import { AI_PROVIDERS } from '@/lib/settings'
import { getAiConfig, getAiStatus, saveAiConfig, type AiConfigView } from '@/lib/dataService'
import { useAuthStore } from '@/stores/authStore'

const inputCls =
  'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

/**
 * AI 凭据是**机构共享的一份**，存在服务端（P3 方案 B）。
 *
 * 原先每个导师在这里填自己的 key，存 localStorage。内测老师多半没有 key，
 * 而 AI 报告是核心卖点 —— 不给 key 等于收不到有效反馈。
 *
 * 管理员在这里维护那一份；普通导师只看到「能不能用」。key 明文从不下发，
 * 回显只有末四位。
 */
export default function AiConfigSection() {
  const isAdmin = useAuthStore(s => s.role) === 'admin'
  return isAdmin ? <AdminEditor /> : <TutorStatus />
}

function TutorStatus() {
  const [state, setState] = useState<{ configured: boolean; model: string } | null>(null)

  useEffect(() => { getAiStatus().then(setState).catch(() => setState(null)) }, [])

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">AI 模型配置</h2>
      {state === null ? (
        <p className="text-xs text-gray-400">读取状态中…</p>
      ) : state.configured ? (
        <p className="text-sm text-gray-700">
          AI 已由管理员统一配置，可直接使用。
          <span className="ml-1 text-xs text-gray-400">当前模型 {state.model}</span>
        </p>
      ) : (
        <p className="text-sm text-amber-700">
          系统还没有配置 AI 凭据，报告生成和知识库对话暂时不可用。请联系管理员。
        </p>
      )}
      <p className="mt-2 text-xs text-gray-400">
        凭据由机构统一提供，不需要你自己申请。调用次数会记录在管理员的账号面板里。
      </p>
    </section>
  )
}

function AdminEditor() {
  const [cfg, setCfg] = useState<AiConfigView | null>(null)
  const [newKey, setNewKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const c = await getAiConfig()
      setCfg(c); setBaseUrl(c.baseUrl); setModel(c.model)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败')
    }
  }

  useEffect(() => { void load() }, [])

  const save = async (patch: { apiKey?: string; baseUrl?: string; model?: string }) => {
    setBusy(true); setMsg(''); setError('')
    try {
      const c = await saveAiConfig(patch)
      setCfg(c); setBaseUrl(c.baseUrl); setModel(c.model); setNewKey('')
      setMsg('已保存')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">AI 模型配置（机构共享）</h2>
      <p className="text-xs text-gray-400 mb-4">
        这一份凭据被所有老师共用，调用次数按人记在账号面板里。支持任何 OpenAI 兼容接口。
      </p>

      {cfg && (
        <p className={`text-sm mb-4 ${cfg.configured ? 'text-gray-700' : 'text-amber-700'}`}>
          {cfg.configured
            ? <>当前 Key <code className="px-1.5 py-0.5 bg-gray-100 rounded">{cfg.keyHint}</code>，已生效。</>
            : '尚未配置 Key —— 所有老师的 AI 功能都不可用。'}
        </p>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {AI_PROVIDERS.map(p => (
          <button
            key={p.label}
            type="button"
            onClick={() => { setBaseUrl(p.baseUrl); setModel(p.model) }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              baseUrl === p.baseUrl
                ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            API Key {cfg?.configured && <span className="text-xs text-gray-400">（留空则不改动）</span>}
          </label>
          <div className="flex gap-2">
            <input
              type="password" value={newKey} onChange={e => setNewKey(e.target.value)}
              placeholder={cfg?.configured ? '粘贴新 Key 以替换' : 'sk-…'}
              className={`${inputCls} flex-1`}
            />
            <button
              type="button" disabled={busy || !newKey.trim()}
              onClick={() => save({ apiKey: newKey.trim() })}
              className="text-sm px-3 py-2 bg-[var(--primary)] text-white rounded-lg disabled:opacity-40"
            >
              {cfg?.configured ? '替换' : '保存'}
            </button>
            {cfg?.configured && (
              <button
                type="button" disabled={busy}
                onClick={() => save({ apiKey: '' })}
                className="text-sm px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                清空
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400">
            保存后服务端只回显末四位，明文不会再下发到任何浏览器。
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Base URL</label>
          <input
            type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1" className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">模型名称</label>
          <input
            type="text" value={model} onChange={e => setModel(e.target.value)}
            placeholder="deepseek-v4-flash / qwen-plus …" className={inputCls}
          />
          <p className="text-xs text-gray-400">
            别用推理模型（deepseek-reasoner 那类）—— max_tokens 会被思维链吃光，正文写不出来。
          </p>
        </div>
        <div>
          <button
            type="button" disabled={busy}
            onClick={() => save({ baseUrl: baseUrl.trim(), model: model.trim() })}
            className="text-sm px-4 py-2 bg-[var(--primary)] text-white rounded-lg disabled:opacity-40"
          >
            保存接口与模型
          </button>
          {msg && <span className="ml-3 text-sm text-green-700">{msg}</span>}
          {error && <span className="ml-3 text-sm text-red-600">{error}</span>}
        </div>
      </div>
    </section>
  )
}
