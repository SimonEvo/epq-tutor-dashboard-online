import { useEffect, useRef, useState } from 'react'
import { getSettings, saveSettings } from '@/lib/settings'
import {
  DEFAULT_SESSION_REPORT_TEMPLATE,
  DEFAULT_PROGRESS_REPORT_TEMPLATE,
} from '@/lib/claudeService'

// ── Variable definitions ──────────────────────────────────────────────────────

interface VarDef {
  name: string
  desc: string
}

const SESSION_VARS: VarDef[] = [
  { name: '{{studentName}}',  desc: '学生姓名（含英文名）' },
  { name: '{{topic}}',        desc: 'EPQ 课题（优先中文版）' },
  { name: '{{sessionType}}',  desc: '课程类型标签' },
  { name: '{{sessionDate}}',  desc: '课程日期与时间' },
  { name: '{{duration}}',     desc: '时长（分钟数）' },
  { name: '{{saUsed}}',       desc: '已用 SA 课次' },
  { name: '{{saTotal}}',      desc: 'SA 总课次' },
  { name: '{{saRemaining}}',  desc: '剩余 SA 课次' },
  { name: '{{today}}',        desc: '今日日期（YYYY-MM-DD）' },
]

const PROGRESS_VARS: VarDef[] = [
  { name: '{{today}}',             desc: '今日日期（YYYY-MM-DD）' },
  { name: '{{studentName}}',       desc: '学生姓名（含英文名）' },
  { name: '{{topic}}',             desc: 'EPQ 课题（优先中文版）' },
  { name: '{{progressPercent}}',   desc: '里程碑完成百分比' },
  { name: '{{saUsed}}',            desc: '已用 SA 课次' },
  { name: '{{saTotal}}',           desc: 'SA 总课次' },
  { name: '{{saRemaining}}',       desc: '剩余 SA 课次' },
  { name: '{{totalSessions}}',     desc: '总课程次数' },
  { name: '{{pastSessionsCount}}', desc: '已完成课程次数' },
  { name: '{{briefNote}}',         desc: '导师简评备注' },
]

const SESSION_AUTO_BLOCK = `学生姓名 / EPQ课题 / 课程类型 / 日期 / 时长 / SA剩余
课程记录 / 课后任务 / 会议记录（如有）`

const PROGRESS_AUTO_BLOCK = `学生姓名 / EPQ课题 / 概要背景
里程碑完成情况（已完成 / 进行中 / 未开始）
所有已完成课程列表
最近一次 SA / TA Meeting 详情
未开始课程安排 / 导师简评
作业追踪记录（最近6条，含 ✓/○ 完成状态 + 备注）`

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'session' | 'progress'

export default function PromptTemplateEditor({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('session')
  const [sessionVal, setSessionVal] = useState('')
  const [progressVal, setProgressVal] = useState('')
  const [saved, setSaved] = useState(false)
  const sessionRef = useRef<HTMLTextAreaElement>(null)
  const progressRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    const s = getSettings()
    setSessionVal(s.sessionReportTemplate || DEFAULT_SESSION_REPORT_TEMPLATE)
    setProgressVal(s.progressReportTemplate || DEFAULT_PROGRESS_REPORT_TEMPLATE)
    setSaved(false)
  }, [open])

  const currentVal = tab === 'session' ? sessionVal : progressVal
  const setCurrentVal = tab === 'session' ? setSessionVal : setProgressVal
  const currentRef = tab === 'session' ? sessionRef : progressRef
  const currentVars = tab === 'session' ? SESSION_VARS : PROGRESS_VARS
  const currentDefault = tab === 'session' ? DEFAULT_SESSION_REPORT_TEMPLATE : DEFAULT_PROGRESS_REPORT_TEMPLATE
  const autoBlock = tab === 'session' ? SESSION_AUTO_BLOCK : PROGRESS_AUTO_BLOCK

  const insertVar = (varName: string) => {
    const ta = currentRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = currentVal.slice(0, start) + varName + currentVal.slice(end)
    setCurrentVal(next)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + varName.length
      ta.focus()
    })
  }

  const handleSave = () => {
    const s = getSettings()
    saveSettings({
      ...s,
      sessionReportTemplate: sessionVal === DEFAULT_SESSION_REPORT_TEMPLATE ? '' : sessionVal,
      progressReportTemplate: progressVal === DEFAULT_PROGRESS_REPORT_TEMPLATE ? '' : progressVal,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setCurrentVal(currentDefault)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative ml-auto w-full max-w-5xl h-full bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-gray-900 text-sm">提示词模板</span>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => setTab('session')}
                className={`px-3 py-1.5 transition-colors ${
                  tab === 'session'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                课后简报
              </button>
              <button
                onClick={() => setTab('progress')}
                className={`px-3 py-1.5 transition-colors border-l border-gray-200 ${
                  tab === 'progress'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                进度报告
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 divide-x divide-gray-100">
          {/* Editor */}
          <div className="flex flex-col flex-1 min-w-0 p-4 gap-3">
            <p className="text-xs text-gray-400 shrink-0">
              编辑指令模板。系统会自动在末尾追加课程数据块（见右侧说明）。
            </p>
            <textarea
              key={tab}
              ref={currentRef}
              value={currentVal}
              onChange={e => setCurrentVal(e.target.value)}
              spellCheck={false}
              className="flex-1 w-full font-mono text-xs leading-relaxed resize-none border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-800 bg-gray-50"
            />
          </div>

          {/* Sidebar */}
          <div className="w-72 shrink-0 flex flex-col p-4 gap-4 overflow-y-auto">
            {/* Variables */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                可用变量
              </p>
              <p className="text-xs text-gray-400 mb-3">
                点击插入到光标位置
              </p>
              <div className="flex flex-col gap-1.5">
                {currentVars.map(v => (
                  <button
                    key={v.name}
                    onClick={() => insertVar(v.name)}
                    className="flex items-start gap-2 text-left px-2.5 py-2 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
                  >
                    <code className="text-xs font-mono text-indigo-600 shrink-0 group-hover:text-indigo-700">
                      {v.name}
                    </code>
                    <span className="text-xs text-gray-500 leading-snug">{v.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-appended block */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                自动追加数据
              </p>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-1.5 font-medium">
                  以下内容在模板之后自动追加：
                </p>
                <pre className="text-xs text-gray-500 whitespace-pre-wrap font-mono leading-relaxed">
                  {autoBlock}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 shrink-0 bg-gray-50">
          <button
            onClick={handleReset}
            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-white transition-colors"
          >
            恢复默认
          </button>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-xs text-green-600">已保存</span>
            )}
            <button
              onClick={handleSave}
              className="text-xs bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
