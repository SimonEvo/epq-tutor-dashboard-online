import { Outlet } from 'react-router-dom'
import { useStudentStore } from '@/stores/studentStore'
import { useEffect, useState } from 'react'
import PromptTemplateEditor from '@/components/PromptTemplateEditor'
import AppSidebar from './AppSidebar'

function BeijingClock() {
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setTime(now.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }))
    }
    update()
    const id = setInterval(update, 30000)
    return () => clearInterval(id)
  }, [])

  return <span className="text-xs text-gray-400 font-mono tabular-nums">{time} CST</span>
}

const CAL_LABEL = {
  idle: null,
  syncing: '📅 同步中…',
  ok: '📅 日历已更新',
  err: '📅 同步失败',
} as const

export default function AppLayout() {
  const calendarSync = useStudentStore(s => s.calendarSync)
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#f5f5f7' }}>
      <AppSidebar onAiClick={() => setPromptEditorOpen(true)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Slim top bar: clock + calendar sync status */}
        <div
          className="flex items-center justify-end gap-4 px-6 shrink-0"
          style={{ height: 40, borderBottom: '1px solid rgba(0,0,0,0.05)' }}
        >
          {calendarSync !== 'idle' && (
            <span className={`text-xs transition-all ${
              calendarSync === 'syncing' ? 'text-gray-400 animate-pulse' :
              calendarSync === 'ok' ? 'text-green-600' :
              'text-red-500'
            }`}>
              {CAL_LABEL[calendarSync]}
            </span>
          )}
          <BeijingClock />
          <button
            onClick={() => setPromptEditorOpen(true)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            提示词
          </button>
        </div>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <PromptTemplateEditor open={promptEditorOpen} onClose={() => setPromptEditorOpen(false)} />
    </div>
  )
}
