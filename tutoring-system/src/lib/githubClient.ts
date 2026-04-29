import { JWT_STORAGE_KEY } from '@/config'

export function getToken(): string | null {
  return localStorage.getItem(JWT_STORAGE_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(JWT_STORAGE_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(JWT_STORAGE_KEY)
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })

  if (res.status === 401) {
    clearToken()
    window.location.hash = '/login'
  }

  return res
}
