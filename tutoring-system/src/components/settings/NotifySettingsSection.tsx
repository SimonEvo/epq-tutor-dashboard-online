import { useEffect, useState } from 'react'
import * as dataService from '@/lib/dataService'
import type { NotifySettings } from '@/lib/dataService'

/**
 * 上课提醒 webhook 设置。webhook 存服务器（tutors 表），和「群催促」用的
 * WECOM_WEBHOOK_URL 是两套，互不影响。
 *
 * 两种推送：每日汇总（前一天晚上 x 点推明天的 / 当天早上 x 点推今天的），
 * 以及单条安排的课前 15 分钟提醒（在各个新建/编辑界面里逐条勾）。
 */

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'

export default function NotifySettingsSection() {
  const [cfg, setCfg] = useState<NotifySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const [preview, setPreview] = useState<string>('')

  useEffect(() => {
    dataService.getNotifySettings().then(setCfg).catch(e => {
      setStatus('err'); setMsg(e instanceof Error ? e.message : String(e))
    })
  }, [])

  const patch = (p: Partial<NotifySettings>) => setCfg(c => c ? { ...c, ...p } : c)

  const save = async () => {
    if (!cfg) return
    setSaving(true); setStatus('idle'); setMsg('')
    try {
      setCfg(await dataService.saveNotifySettings(cfg))
      setStatus('ok'); setMsg('已保存')
    } catch (e) {
      setStatus('err'); setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true); setStatus('idle'); setMsg('')
    try {
      const r = await dataService.testNotifyPush()
      setStatus(r.ok ? 'ok' : 'err')
      setMsg(r.ok ? `已推送 ${r.date} 的 ${r.items} 项安排，去群里看看` : `推送失败：${r.error}`)
    } catch (e) {
      setStatus('err'); setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  const loadPreview = async () => {
    setMsg(''); setStatus('idle')
    try {
      const r = await dataService.previewNotifyDigest()
      setPreview(r.markdown)
    } catch (e) {
      setStatus('err'); setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  if (!cfg) {
    return (
      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">上课提醒</h2>
        <p className="text-xs text-gray-400">{status === 'err' ? msg : '加载中…'}</p>
      </section>
    )
  }

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">上课提醒</h2>
      <p className="text-xs text-gray-400 mb-4">
        推到企业微信群机器人（markdown）。和「群催促」用的是两个独立 webhook，互不影响。
        单条安排的课前 15 分钟提醒，在各自的新建 / 编辑界面里逐条勾。
      </p>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none mb-4">
        <input
          type="checkbox" checked={cfg.enabled}
          onChange={e => patch({ enabled: e.target.checked })}
          className="w-4 h-4 accent-[var(--primary)]"
        />
        启用上课提醒（总开关，关掉后每日汇总和课前提醒都不推）
      </label>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Webhook 地址</label>
        <input
          value={cfg.webhookUrl}
          onChange={e => patch({ webhookUrl: e.target.value })}
          placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
          className={`${inputCls} font-mono text-xs`}
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-2">每日汇总</label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([['prev_evening', '前一天晚上'], ['same_morning', '当天早上']] as const).map(([mode, label]) => (
              <button
                key={mode} type="button"
                onClick={() => patch({ digestMode: mode })}
                className={`text-xs px-3 py-1.5 transition-colors ${
                  cfg.digestMode === mode
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="time" value={cfg.digestTime}
            onChange={e => patch({ digestTime: e.target.value })}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
          <span className="text-xs text-gray-400">
            推{cfg.digestMode === 'prev_evening' ? '第二天' : '当天'}的全部安排（北京时间）
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={save} disabled={saving}
          className="text-sm px-4 py-1.5 rounded-lg bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button" onClick={test} disabled={testing || !cfg.webhookUrl}
          className="text-sm px-4 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          title="按当前配置立刻推一条，验证 webhook 通不通（不看总开关）"
        >
          {testing ? '推送中…' : '测试推送'}
        </button>
        <button
          type="button" onClick={loadPreview}
          className="text-sm px-4 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          预览内容
        </button>
        {msg && (
          <span className={`text-xs ${status === 'err' ? 'text-red-500' : 'text-green-600'}`}>{msg}</span>
        )}
      </div>

      {preview && (
        <pre className="mt-4 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap font-mono text-gray-700">
          {preview}
        </pre>
      )}
    </section>
  )
}
