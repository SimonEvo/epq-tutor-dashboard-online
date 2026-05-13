import { create } from 'zustand'
import { JWT_STORAGE_KEY } from '@/config'
import { setToken, clearToken, getToken } from '@/lib/githubClient'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  // 从 localStorage 同步初始化，避免页面跳转闪烁
  // Token 过期由 apiFetch 的 401 处理自动跳转 /login
  isAuthenticated: !!getToken(),
  isLoading: false,

  login: async (username: string, password: string) => {
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) return false
      const data = await res.json() as { access_token: string }
      setToken(data.access_token)
      set({ isAuthenticated: true })
      return true
    } catch {
      return false
    }
  },

  logout: () => {
    clearToken()
    set({ isAuthenticated: false })
  },

  checkAuth: async () => {
    set({ isAuthenticated: !!getToken() })
  },
}))

// keep named export for legacy import compatibility
export { JWT_STORAGE_KEY }
