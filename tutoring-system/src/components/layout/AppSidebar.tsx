import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

const STORAGE_KEY = 'sidebar-collapsed'

// Minimal inline SVG icons
const Icons = {
  students: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  supervisors: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/>
      <path d="M20 21a8 8 0 1 0-16 0"/>
      <path d="M16 11l1.5 1.5L20 10"/>
    </svg>
  ),
  ai: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z"/>
    </svg>
  ),
  zoom: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z"/>
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  collapse: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  expand: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  logout: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
}

interface NavItem {
  to?: string
  label: string
  icon: React.ReactNode
  onClick?: () => void
}

interface Props {
  onAiClick?: () => void
}

export default function AppSidebar({ onAiClick }: Props) {
  const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
    {
      label: '主要',
      items: [
        { to: '/', label: '学生', icon: Icons.students },
        { to: '/supervisors', label: '督导', icon: Icons.supervisors },
      ],
    },
    {
      label: '工具',
      items: [
        { label: 'AI 指令', icon: Icons.ai, onClick: onAiClick },
        { to: '/zoom-config', label: 'Zoom', icon: Icons.zoom },
      ],
    },
    {
      label: '系统',
      items: [
        { to: '/settings', label: '设置', icon: Icons.settings },
      ],
    },
  ]
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === 'true'
  )
  const location = useLocation()
  const logout = useAuthStore(s => s.logout)

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(STORAGE_KEY, String(next))
  }

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  return (
    <div
      className="relative flex flex-col h-screen shrink-0 transition-all duration-200"
      style={{
        width: collapsed ? 56 : 220,
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-3 py-4 border-b shrink-0"
        style={{ borderColor: 'rgba(0,0,0,0.06)', minHeight: 56 }}
      >
        <div
          className="shrink-0 flex items-center justify-center rounded-lg text-white text-xs font-bold"
          style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #5B52D6, #818cf8)', fontSize: 14 }}
        >
          E
        </div>
        {!collapsed && (
          <span className="font-semibold text-sm text-gray-900 whitespace-nowrap overflow-hidden">
            EPQ Tutor
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            {!collapsed && (
              <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 px-2 mb-1">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = item.to ? isActive(item.to) : false
                const sharedStyle = {
                  background: active ? 'rgba(91,82,214,0.08)' : 'transparent',
                  color: active ? '#5B52D6' : '#6b7280',
                }
                const sharedClass = "flex items-center gap-2.5 rounded-lg px-2 py-2 transition-all duration-150 w-full text-left"
                const content = (
                  <>
                    <span className="shrink-0">{item.icon}</span>
                    {!collapsed && (
                      <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
                    )}
                    {active && !collapsed && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                    )}
                  </>
                )
                const hoverProps = {
                  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
                    if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'
                  },
                  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
                    if (!active) (e.currentTarget as HTMLElement).style.background = active ? 'rgba(91,82,214,0.08)' : 'transparent'
                  },
                }
                return item.to ? (
                  <Link
                    key={item.label}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    className={sharedClass}
                    style={sharedStyle}
                    {...hoverProps}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    title={collapsed ? item.label : undefined}
                    className={sharedClass}
                    style={sharedStyle}
                    onClick={item.onClick}
                    {...hoverProps}
                  >
                    {content}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: user + logout */}
      <div className="shrink-0 border-t px-2 py-3 space-y-0.5" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
        <button
          onClick={logout}
          title={collapsed ? '退出登录' : undefined}
          className="w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-gray-400 hover:text-gray-700 transition-colors"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <span className="shrink-0">{Icons.logout}</span>
          {!collapsed && <span className="text-sm">退出登录</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        className="absolute -right-3 top-14 w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors z-10"
        style={{
          background: 'white',
          border: '1px solid rgba(0,0,0,0.1)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}
      >
        {collapsed ? Icons.expand : Icons.collapse}
      </button>
    </div>
  )
}
