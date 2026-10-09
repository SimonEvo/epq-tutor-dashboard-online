import { create } from 'zustand'
import { JWT_STORAGE_KEY } from '@/config'
import { setToken, clearToken, getToken } from '@/lib/githubClient'
import { fetchMe } from '@/lib/dataService'

export type Role = 'tutor' | 'admin'

const ROLE_KEY = 'epq_tutor_role'

/**
 * 角色缓存在 localStorage 只为**首屏不闪**（否则管理入口会先隐藏再冒出来）。
 * 它不是权限依据：每个管理端点都各自 require_admin，前端改这个值什么也拿不到。
 */
function cachedRole(): Role {
  try {
    return localStorage.getItem(ROLE_KEY) === 'admin' ? 'admin' : 'tutor'
  } catch {
    return 'tutor'
  }
}

function cacheRole(role: Role) {
  try { localStorage.setItem(ROLE_KEY, role) } catch { /* 隐私模式下写不进，忽略 */ }
}

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  role: Role
  username: string
  displayName: string
  loginError: string
  isAdmin: () => boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // 从 localStorage 同步初始化，避免页面跳转闪烁
  // Token 过期由 apiFetch 的 401 处理自动跳转 /login
  isAuthenticated: !!getToken(),
  isLoading: false,
  role: cachedRole(),
  username: '',
  displayName: '',
  loginError: '',

  isAdmin: () => get().role === 'admin',

  login: async (username: string, password: string) => {
    set({ loginError: '' })
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        // 账号被停用（403）和密码错（401）要分开提示 —— 否则对方会一直重试密码
        const body = await res.json().catch(() => null) as { detail?: string } | null
        set({ loginError: body?.detail || '用户名或密码错误' })
        return false
      }
      const data = await res.json() as {
        access_token: string; role?: Role; username?: string; displayName?: string
      }
      setToken(data.access_token)
      const role: Role = data.role === 'admin' ? 'admin' : 'tutor'
      cacheRole(role)
      set({
        isAuthenticated: true,
        role,
        username: data.username ?? username,
        displayName: data.displayName ?? '',
        loginError: '',
      })
      return true
    } catch {
      set({ loginError: '无法连接服务器' })
      return false
    }
  },

  logout: () => {
    clearToken()
    try { localStorage.removeItem(ROLE_KEY) } catch { /* 忽略 */ }
    set({ isAuthenticated: false, role: 'tutor', username: '', displayName: '' })
  },

  checkAuth: async () => {
    if (!getToken()) {
      set({ isAuthenticated: false })
      return
    }
    set({ isAuthenticated: true })
    // 以服务端为准刷新角色：管理员权限可能在别处被改掉，缓存会过期
    try {
      const me = await fetchMe()
      const role: Role = me.role === 'admin' ? 'admin' : 'tutor'
      cacheRole(role)
      set({ role, username: me.username, displayName: me.displayName })
    } catch { /* 网络问题就沿用缓存值，下次再刷 */ }
  },
}))

// keep named export for legacy import compatibility
export { JWT_STORAGE_KEY }
