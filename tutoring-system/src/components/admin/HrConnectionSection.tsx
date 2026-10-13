import { useEffect, useState } from 'react'
import { getHrConfig, refreshHrMirror, saveHrConfig, type HrConfigView } from '@/lib/dataService'

const inputCls =
  'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

function fmt(iso: string): string {
  if (!iso) return '从未'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 教务连接（ADR 0008）。只读消费教务的 /api/integrations/online-form/v1。
 * token 和 AI key 一样：存服务端，只回显末四位。
 *
 * onRefreshed：拉取后教务老师名单可能变了，让父组件重新加载关联下拉。
 */
export default function HrConnectionSection({ onRefreshed }: { onRefreshed: () => void }) {
  const [cfg, setCfg] = useState<HrConfigView | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const c = await getHrConfig()
      setCfg(c); setBaseUrl(c.baseUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败')
    }
  }

  useEffect(() => { void load() }, [])

  const run = async (fn: () => Promise<unknown>, ok: (r: unknown) => string) => {
    setBusy(true); setMsg(''); setError('')
    try {
      const r = await fn()
      setMsg(ok(r))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-[var(--border)] p-5 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">教务连接</h2>
      <p className="text-xs text-gray-500 mb-4">
        只读拉取教务的学生和老师分配。教务那边需要给本系统发一个专用 service token；
        在那之前可以对着本地 mock 调试。
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://教务域名/api/integrations/online-form/v1" className={inputCls} />
        <input type="password" value={token} onChange={e => setToken(e.target.value)}
          placeholder={cfg?.tokenHint ? `当前 ${cfg.tokenHint}，留空不改` : 'service token'}
          className={inputCls} />
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          disabled={busy}
          onClick={() => run(
            () => saveHrConfig({ baseUrl: baseUrl.trim(), ...(token.trim() ? { token: token.trim() } : {}) }),
            () => { setToken(''); return '已保存' },
          )}
          className="text-sm px-3 py-2 bg-[var(--primary)] text-white rounded-lg disabled:opacity-40"
        >
          保存连接
        </button>
        <button
          disabled={busy || !cfg?.configured}
          onClick={() => run(refreshHrMirror, r => {
            onRefreshed()
            const res = r as { fetched: number; mirrorCount: number }
            return `拉取完成：更新 ${res.fetched} 个项目，本地共 ${res.mirrorCount} 个`
          })}
          className="text-sm px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          立即拉取
        </button>
        {msg && <span className="text-sm text-green-700">{msg}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {cfg && (
        <p className="mt-3 text-xs text-gray-500">
          {cfg.configured ? '已配置' : '未配置'} · 上次拉取 {fmt(cfg.lastRefreshAt)} ·
          本地镜像 {cfg.mirrorCount} 个项目 · 位点 {cfg.cursor}
        </p>
      )}
    </section>
  )
}
