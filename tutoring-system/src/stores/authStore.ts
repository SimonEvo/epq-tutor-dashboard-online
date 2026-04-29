import { create } from 'zustand'
import { JWT_STORAGE_KEY } from '@/config'
import { setToken, clearToken, getToken, apiFetch } from '@/lib/githubClient'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,

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
    const token = getToken()
    if (!token) {
      set({ isAuthenticated: false, isLoading: false })
      return
    }
    try {
      const res = await apiFetch('/health')
      set({ isAuthenticated: res.ok, isLoading: false })
    } catch {
      set({ isAuthenticated: false, isLoading: false })
    }
  },
}))

// keep named export for legacy import compatibility
export { JWT_STORAGE_KEY }
