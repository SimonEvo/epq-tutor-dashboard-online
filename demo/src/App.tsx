import { useEffect, useState } from 'react'
import type { Page } from './types'
import { useStudents } from './store'
import Dashboard from './pages/Dashboard'
import StudentDetail from './pages/StudentDetail'
import GanttPage from './pages/GanttPage'
import ReportPage from './pages/ReportPage'
import FeedbackPanel from './components/FeedbackPanel'

const I = {
  students: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  gantt: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 5-5" />
      <line x1="7" y1="8" x2="7" y2="20" opacity="0.4" />
    </svg>
  ),
  ai: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" />
    </svg>
  ),
}

function BeijingClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      )
    update()
    const id = setInterval(update, 30000)
    return () => clearInterval(id)
  }, [])
  return <span className="clock">{time} CST</span>
}

function pageFromHash(): Page | null {
  const h = window.location.hash.replace(/^#\/?/, '')
  if (h.startsWith('student/')) return { kind: 'student', id: h.slice(8) }
  if (h === 'gantt') return { kind: 'gantt' }
  if (h === 'report') return { kind: 'report' }
  if (h === '' || h === 'dashboard') return { kind: 'dashboard' }
  return null
}

export default function App() {
  const { students, update, reset } = useStudents()
  const [page, setPage] = useState<Page>(pageFromHash() ?? { kind: 'dashboard' })
  const [round, setRound] = useState<string>('26秋')
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const nav = (p: Page) => {
    setPage(p)
    window.location.hash =
      p.kind === 'student' ? `/student/${p.id}` : p.kind === 'gantt' ? '/gantt' : p.kind === 'report' ? '/report' : '/dashboard'
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    const onHash = () => setPage(pageFromHash() ?? { kind: 'dashboard' })
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const pageName =
    page.kind === 'dashboard'
      ? 'Dashboard'
      : page.kind === 'student'
        ? '学生详情'
        : page.kind === 'gantt'
          ? '甘特图'
          : '周报'

  const mainActive = page.kind === 'dashboard' || page.kind === 'student'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">E</span>
          <span className="brand-text">
            EPQ Tutor
            <small>内测 Demo</small>
          </span>
        </div>
        <nav>
          <div className="nav-group">主要</div>
          <button className={mainActive ? 'active' : ''} onClick={() => nav({ kind: 'dashboard' })}>
            <span className="nav-icon">{I.students}</span>
            <span className="nav-label">学生</span>
          </button>
          <button className={page.kind === 'gantt' ? 'active' : ''} onClick={() => nav({ kind: 'gantt' })}>
            <span className="nav-icon">{I.gantt}</span>
            <span className="nav-label">甘特图</span>
          </button>
          <div className="nav-group">工具</div>
          <button className={page.kind === 'report' ? 'active' : ''} onClick={() => nav({ kind: 'report' })}>
            <span className="nav-icon">{I.ai}</span>
            <span className="nav-label">AI 周报</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className="reset-btn"
            onClick={() => {
              if (window.confirm('重置所有虚拟数据并清空反馈？')) reset()
            }}
          >
            ↺ 重置演示数据
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <span className="demo-pill">演示环境 · 数据均为虚构</span>
          <BeijingClock />
        </div>
        <div className="demo-banner">
          ⚠️ 内测演示环境 · 所有学生与数据均为虚构，仅供功能体验与反馈收集
        </div>
        <div className="page">
          {page.kind === 'dashboard' && (
            <Dashboard students={students} round={round} setRound={setRound} nav={nav} />
          )}
          {page.kind === 'student' && (
            <StudentDetail student={students.find((s) => s.id === page.id)!} update={update} nav={nav} />
          )}
          {page.kind === 'gantt' && <GanttPage students={students} round={round} nav={nav} />}
          {page.kind === 'report' && <ReportPage students={students} round={round} />}
        </div>
      </div>

      <button className="feedback-fab" onClick={() => setFeedbackOpen(true)}>
        💬 内测反馈
      </button>
      {feedbackOpen && <FeedbackPanel page={pageName} onClose={() => setFeedbackOpen(false)} />}
    </div>
  )
}
