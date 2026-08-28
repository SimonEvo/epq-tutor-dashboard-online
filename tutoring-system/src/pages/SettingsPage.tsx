import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getSettings, saveSettings, AI_PROVIDERS } from '@/lib/settings'
import { publishCalendar, calendarUrl as getCalendarUrl } from '@/lib/calendarService'
import { useStudentStore } from '@/stores/studentStore'
import * as dataService from '@/lib/dataService'
import { getToken } from '@/lib/githubClient'
import { THEMES } from '@/lib/themes'
import { useThemeStore } from '@/stores/themeStore'
import SubmissionTemplateSettings from '@/components/SubmissionTemplateSettings'
import RoundManagementSection from '@/components/settings/RoundManagementSection'

type SettingsCategory = 'appearance' | 'teaching' | 'integrations' | 'ai' | 'data'

const CATEGORIES: { id: SettingsCategory; label: string; hint: string }[] = [
  { id: 'appearance', label: '外观', hint: '界面主题' },
  { id: 'teaching', label: '教学', hint: '学期 / 提交清单 / 知识库' },
  { id: 'integrations', label: '集成', hint: '日历 / Zoom / 腾讯文档' },
  { id: 'ai', label: 'AI', hint: 'AI 模型配置' },
  { id: 'data', label: '数据', hint: '备份与恢复' },
]

const KB_SOURCE_LABELS: [dataService.KbSource, string][] = [
  ['sessions', '课程历史 + 记录'],
  ['sa_hours', 'SA 课时 / 时长'],
  ['meeting_dates', '上次/下次 SA·TA 日期'],
  ['milestones', 'EPQ 里程碑'],
  ['schedule_entries', '考试 / 可用时间'],
  ['submission_round', '提交学期'],
  ['profile', '概览 / 课题 / 速记'],
  ['private_notes', '导师私人备注'],
  ['homework', '作业清单'],
  ['gantt_events', '甘特事件'],
]

export default function SettingsPage() {
  const [cat, setCat] = useState<SettingsCategory>(
    () => (localStorage.getItem('settings-category') as SettingsCategory) ?? 'appearance'
  )

  const handleCat = (next: SettingsCategory) => {
    setCat(next)
    localStorage.setItem('settings-category', next)
  }

  const [settings, setSettings] = useState(getSettings)
  const [saved, setSaved] = useState(false)
  const [calSyncing, setCalSyncing] = useState(false)
  const [calStatus, setCalStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [calError, setCalError] = useState('')
  const [backupStatus, setBackupStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [backupMsg, setBackupMsg] = useState('')
  const [backups, setBackups] = useState<{ date: string; students: number; supervisors: number }[]>([])
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [restoreMsg, setRestoreMsg] = useState('')
  const rounds = useStudentStore(s => s.rounds)
  const fetchRounds = useStudentStore(s => s.fetchRounds)
  const [defaultRound, setDefaultRound] = useState('')
  const [defaultRoundSaving, setDefaultRoundSaving] = useState(false)
  const [kbSources, setKbSources] = useState<dataService.KbSourceToggles | null>(null)
  const [kbSaving, setKbSaving] = useState(false)

  const themeId = useThemeStore(s => s.themeId)
  const setTheme = useThemeStore(s => s.setTheme)

  const students = useStudentStore(s => s.students)
  const calendarUrlFromStore = useStudentStore(s => s.calendarUrl)
  const [calendarUrl, setCalendarUrl] = useState<string | null>(calendarUrlFromStore)

  useEffect(() => {
    if (!calendarUrl) setCalendarUrl(getCalendarUrl())
    fetchRounds()
    dataService.getDefaultRound().then(setDefaultRound).catch(() => {})
    dataService.listBackups().then(setBackups).catch(() => {})
    dataService.getKbSources().then(setKbSources).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep in sync if a background save updated the store URL.
  useEffect(() => {
    if (calendarUrlFromStore) setCalendarUrl(calendarUrlFromStore)
  }, [calendarUrlFromStore])

  const handleSyncCalendar = async () => {
    setCalSyncing(true)
    setCalStatus('idle')
    setCalError('')
    try {
      const url = await publishCalendar(students)
      setCalendarUrl(url)
      setCalStatus('ok')
    } catch (e) {
      setCalStatus('err')
      setCalError(e instanceof Error ? e.message : String(e))
    } finally {
      setCalSyncing(false)
    }
  }

  const handleCopyUrl = () => {
    if (calendarUrl) navigator.clipboard.writeText(calendarUrl)
  }

  const handleBackup = async () => {
    setBackupStatus('loading')
    setBackupMsg('')
    try {
      const result = await dataService.exportBackup()
      setBackupStatus('ok')
      setBackupMsg(`已备份 ${result.students} 名学生、${result.supervisors} 位督导、${result.tags} 个标签 → ${result.path}`)
      dataService.listBackups().then(setBackups).catch(() => {})
    } catch (e) {
      setBackupStatus('err')
      setBackupMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'loading' | 'err'>('idle')
  const [downloadMsg, setDownloadMsg] = useState('')
  const handleDownloadLocal = async () => {
    setDownloadStatus('loading')
    setDownloadMsg('')
    try {
      await dataService.downloadLocalBackup(getToken() || '')
      setDownloadStatus('idle')
    } catch (e) {
      setDownloadStatus('err')
      setDownloadMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [uploadMsg, setUploadMsg] = useState('')
  const handleRestoreLocal = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''  // allow re-selecting the same file
    if (!file) return
    if (!window.confirm(`确定要从「${file.name}」恢复吗？同名的学生、督导、标签会被覆盖。`)) return
    setUploadStatus('loading')
    setUploadMsg('')
    try {
      const result = await dataService.restoreLocalBackup(file)
      setUploadStatus('ok')
      setUploadMsg(`已恢复 ${result.restored.students} 名学生、${result.restored.supervisors} 位督导、${result.restored.tags} 个标签`)
      dataService.listBackups().then(setBackups).catch(() => {})
    } catch (err) {
      setUploadStatus('err')
      setUploadMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRestore = async (date: string) => {
    if (!window.confirm(`确定要恢复 ${date} 的备份吗？当前数据会被覆盖。`)) return
    setRestoreStatus('loading')
    setRestoreMsg('')
    try {
      const result = await dataService.restoreBackup(date)
      const r = result.restored
      setRestoreStatus('ok')
      setRestoreMsg(`已恢复 ${r.students} 名学生、${r.supervisors} 位督导、${r.tags} 个标签，即将刷新页面…`)
      setTimeout(() => window.location.reload(), 1500)
    } catch (e) {
      setRestoreStatus('err')
      setRestoreMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
      </div>

      <div className="flex gap-6 items-start">
        {/* 左侧分类目录 —— 右侧只渲染当前分类（真 tab，不是锚点滚动） */}
        <nav className="w-40 shrink-0 flex flex-col gap-1 sticky top-6">
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleCat(c.id)}
              className={`text-left px-3 py-2 rounded-xl transition-colors ${
                cat === c.id ? 'bg-white border border-gray-200 shadow-sm' : 'hover:bg-white/60 border border-transparent'
              }`}
            >
              <span className={`block text-sm ${cat === c.id ? 'font-medium text-gray-900' : 'text-gray-600'}`}>{c.label}</span>
              <span className="block text-[11px] text-gray-400 truncate">{c.hint}</span>
            </button>
          ))}
        </nav>

      <form onSubmit={handleSave} className="flex-1 min-w-0 flex flex-col gap-5">

        {/* Theme */}
        {cat === 'appearance' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">界面主题</h2>
          <p className="text-xs text-gray-400 mb-4">即时切换，无需刷新页面。</p>
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={`relative flex flex-col gap-2 rounded-xl border-2 p-3 text-left transition-all ${
                  themeId === t.id ? 'border-[var(--primary)] bg-[var(--primary-bg)]' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex gap-1.5">
                  <span className="w-5 h-5 rounded-full shrink-0" style={{ background: t.primary }} />
                  <span className="w-5 h-5 rounded-full shrink-0" style={{ background: t.accent }} />
                  <span className="w-5 h-5 rounded-full shrink-0 border border-gray-200" style={{ background: t.bg }} />
                </div>
                <span className="text-xs font-medium text-gray-700 leading-tight">{t.label}</span>
                {themeId === t.id && (
                  <span className="absolute top-2 right-2 text-[var(--primary)] text-xs font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        </section>
        )}

        {/* iCloud Calendar */}
        {cat === 'integrations' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">iCloud 日历同步</h2>
          <p className="text-xs text-gray-400 mb-4">
            每次保存 Session 后会自动更新日历。日历以私密 Gist 托管，URL 含随机 ID，不可被搜索或猜测。
          </p>

          {/* Subscription URL */}
          {calendarUrl ? (
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 truncate select-all">
                {calendarUrl}
              </code>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="shrink-0 text-xs px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                复制
              </button>
            </div>
          ) : (
            <div className="mb-4 text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              点击「立即同步日历」生成订阅链接（首次创建 Gist）
            </div>
          )}

          {/* How to subscribe */}
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-xs font-medium text-gray-700 mb-2">如何订阅（一次性操作）</p>
            <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
              <li>在 Mac 上打开「日历」app</li>
              <li>菜单栏 → 文件 → 新建日历订阅…</li>
              <li>粘贴上方 URL，点击「订阅」</li>
              <li>设置日历名称和自动刷新频率（建议每小时）</li>
            </ol>
          </div>

          {/* Manual sync */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSyncCalendar}
              disabled={calSyncing || students.length === 0}
              className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              {calSyncing ? '同步中…' : '立即同步日历'}
            </button>
            {calStatus === 'ok' && (
              <span className="text-xs text-green-600">同步成功 ✓</span>
            )}
            {calStatus === 'err' && (
              <span className="text-xs text-red-500">同步失败：{calError || '未知错误'}</span>
            )}
            {students.length === 0 && calStatus === 'idle' && (
              <span className="text-xs text-gray-400">请先从 Dashboard 加载学生数据</span>
            )}
          </div>
        </section>
        )}

        {/* AI Model */}
        {cat === 'ai' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">AI 模型配置</h2>
          <p className="text-xs text-gray-400 mb-4">
            支持任何 OpenAI 兼容接口。选择预设厂商或手动填写 Base URL 和模型名称。
          </p>

          {/* Provider presets */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {AI_PROVIDERS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => setSettings(s => ({ ...s, aiBaseUrl: p.baseUrl, aiModel: p.model }))}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  settings.aiBaseUrl === p.baseUrl
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
              <label className="text-sm font-medium text-gray-700">API Key</label>
              <input
                type="password"
                value={settings.aiApiKey}
                onChange={e => setSettings(s => ({ ...s, aiApiKey: e.target.value }))}
                placeholder="sk-…"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">Base URL</label>
              <input
                type="text"
                value={settings.aiBaseUrl}
                onChange={e => setSettings(s => ({ ...s, aiBaseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">模型名称</label>
              <input
                type="text"
                value={settings.aiModel}
                onChange={e => setSettings(s => ({ ...s, aiModel: e.target.value }))}
                placeholder="gpt-4o / qwen-plus / deepseek-v4-flash …"
                className={inputCls}
              />
            </div>
          </div>
        </section>
        )}

        {/* Data Backup & Restore */}
        {cat === 'data' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">数据备份与恢复</h2>
          <p className="text-xs text-gray-400 mb-4">
            每天自动备份一次到服务器，保留最近 3 天；也可手动立即备份，或下载完整数据到本地电脑。
          </p>
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <button
              type="button"
              onClick={handleBackup}
              disabled={backupStatus === 'loading'}
              className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              {backupStatus === 'loading' ? '备份中…' : '立即备份到服务器'}
            </button>
            <button
              type="button"
              onClick={handleDownloadLocal}
              disabled={downloadStatus === 'loading'}
              className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              {downloadStatus === 'loading' ? '打包中…' : '下载到本地'}
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleRestoreLocal}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploadStatus === 'loading'}
              className="text-sm px-4 py-2 border border-orange-200 rounded-lg text-orange-600 hover:bg-orange-50 disabled:opacity-40 transition-colors"
            >
              {uploadStatus === 'loading' ? '恢复中…' : '从本地文件恢复'}
            </button>
            {backupStatus === 'ok' && (
              <span className="text-xs text-green-600">{backupMsg}</span>
            )}
            {backupStatus === 'err' && (
              <span className="text-xs text-red-500">备份失败：{backupMsg}</span>
            )}
            {downloadStatus === 'err' && (
              <span className="text-xs text-red-500">下载失败：{downloadMsg}</span>
            )}
            {uploadStatus === 'ok' && (
              <span className="text-xs text-green-600">{uploadMsg}</span>
            )}
            {uploadStatus === 'err' && (
              <span className="text-xs text-red-500">恢复失败：{uploadMsg}</span>
            )}
          </div>

          {backups.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-500 mb-2">可恢复的备份</h3>
              <div className="space-y-2">
                {backups.map(b => (
                  <div key={b.date} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2">
                    <span className="text-sm text-gray-700">
                      {b.date}
                      <span className="text-xs text-gray-400 ml-2">{b.students} 名学生、{b.supervisors} 位督导</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRestore(b.date)}
                      disabled={restoreStatus === 'loading'}
                      className="text-xs px-3 py-1 border border-orange-200 rounded-md text-orange-600 hover:bg-orange-50 disabled:opacity-40 transition-colors"
                    >
                      恢复
                    </button>
                  </div>
                ))}
              </div>
              {restoreStatus === 'ok' && (
                <p className="text-xs text-green-600 mt-2">{restoreMsg}</p>
              )}
              {restoreStatus === 'err' && (
                <p className="text-xs text-red-500 mt-2">恢复失败：{restoreMsg}</p>
              )}
            </div>
          )}
        </section>
        )}

        {/* Zoom API — link to dedicated config page */}
        {cat === 'integrations' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-1">Zoom 账号配置</h2>
              <p className="text-xs text-gray-400">
                管理多个 Zoom Server-to-Server OAuth 账号，用于 API 拉取会议记录和预约会议。
              </p>
            </div>
            <Link
              to="/zoom-config"
              className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
            >
              管理账号 →
            </Link>
          </div>
        </section>
        )}

        {/* Tencent Docs (future) */}
        {cat === 'teaching' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">默认学期</h2>
          <p className="text-xs text-gray-400 mb-3">Dashboard 打开时若无记忆则自动筛选此学期。两个学期 overlap 时可在此切换。</p>
          <div className="flex items-center gap-3">
            <select
              value={defaultRound}
              onChange={e => setDefaultRound(e.target.value)}
              className={`${inputCls} max-w-xs`}
            >
              <option value="">— 不设置默认（显示全部）</option>
              {rounds.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button
              type="button"
              disabled={defaultRoundSaving}
              onClick={async () => {
                setDefaultRoundSaving(true)
                await dataService.setDefaultRound(defaultRound).catch(() => {})
                setDefaultRoundSaving(false)
              }}
              className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors shrink-0"
            >
              {defaultRoundSaving ? '保存中…' : '保存'}
            </button>
          </div>
        </section>
        )}

        {cat === 'teaching' && (
          <RoundManagementSection onArchived={name => { if (defaultRound === name) setDefaultRound('') }} />
        )}

        {cat === 'teaching' && <SubmissionTemplateSettings />}

        {cat === 'teaching' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">知识库上下文来源</h2>
          <p className="text-xs text-gray-400 mb-3">开聊时自动装配进上下文的数据源。关掉你不维护的项（如作业）。默认全开，对所有学生生效。</p>
          {kbSources === null ? (
            <p className="text-xs text-gray-300">加载中…</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {KB_SOURCE_LABELS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={kbSources[key]}
                      onChange={() => setKbSources(s => s ? { ...s, [key]: !s[key] } : s)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={kbSaving}
                onClick={async () => {
                  if (!kbSources) return
                  setKbSaving(true)
                  const res = await dataService.putKbSources(kbSources).catch(() => null)
                  if (res) setKbSources(res)
                  setKbSaving(false)
                }}
                className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors mt-1"
              >
                {kbSaving ? '保存中…' : '保存'}
              </button>
            </div>
          )}
        </section>
        )}


        {cat === 'integrations' && (
        <section className="bg-white rounded-2xl border border-gray-200 p-6 opacity-60">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold text-gray-900">腾讯文档 API</h2>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">即将支持</span>
          </div>
          <p className="text-xs text-gray-400">
            配置后可一键将报告推送至各学生腾讯文档，无需手动复制粘贴。
            需要在腾讯文档开放平台注册应用（企业账号），详见文档。
          </p>
        </section>
        )}

        {/* 只有 AI 那节的字段挂在 settings 上，其余分类都是各自即时保存 */}
        {cat === 'ai' && (
          <div className="flex gap-3">
            <button
              type="submit"
              className="bg-[var(--primary)] text-white text-sm px-5 py-2 rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
            >
              {saved ? '已保存 ✓' : 'Save Settings'}
            </button>
            <Link to="/" className="text-sm px-5 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
              Cancel
            </Link>
          </div>
        )}
      </form>
      </div>
    </div>
  )
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]'
