import { apiFetch } from './githubClient'
import { API_BASE_URL } from '@/config'
import type { Student, Supervisor, WeeklyReportData } from '@/types'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await apiFetch(`${API_BASE_URL}${path}`, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: unknown }
    const msg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
    throw new Error(msg ?? `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ─── Students ────────────────────────────────────────────────────────────────

export async function listStudents(): Promise<Student[]> {
  return api<Student[]>('/students')
}

export async function getStudent(id: string): Promise<Student> {
  return api<Student>(`/students/${id}`)
}

export async function saveStudent(student: Student): Promise<void> {
  await api(`/students/${student.id}`, { method: 'PUT', body: JSON.stringify(student) })
}

export async function deleteStudent(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/students/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export async function getTags(): Promise<string[]> {
  const data = await api<{ tags: string[] }>('/config/tags')
  return data.tags
}

export async function saveTags(tags: string[]): Promise<void> {
  await api('/config/tags', { method: 'PUT', body: JSON.stringify({ tags }) })
}

// ─── Rounds ──────────────────────────────────────────────────────────────────

export async function getRounds(): Promise<string[]> {
  try {
    return await api<string[]>('/config/rounds')
  } catch {
    return []
  }
}

export async function saveRounds(rounds: string[]): Promise<void> {
  await api('/config/rounds', { method: 'PUT', body: JSON.stringify(rounds) })
}

// ─── Supervisors ─────────────────────────────────────────────────────────────

export async function listSupervisors(): Promise<Supervisor[]> {
  return api<Supervisor[]>('/supervisors')
}

export async function saveSupervisor(supervisor: Supervisor): Promise<void> {
  await api(`/supervisors/${supervisor.id}`, { method: 'PUT', body: JSON.stringify(supervisor) })
}

export async function deleteSupervisor(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/supervisors/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}

// ─── Weekly Report ────────────────────────────────────────────────────────────

export async function getWeeklyReportData(): Promise<WeeklyReportData | null> {
  try {
    return await api<WeeklyReportData>('/weekly-report')
  } catch {
    return null
  }
}

export async function saveWeeklyReportData(data: WeeklyReportData): Promise<void> {
  await api('/weekly-report', { method: 'PUT', body: JSON.stringify(data) })
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export async function getCalendarGistId(): Promise<string | null> {
  try {
    const data = await api<{ gistId: string }>('/config/calendar')
    return data.gistId ?? null
  } catch {
    return null
  }
}

export async function saveCalendarGistId(gistId: string): Promise<void> {
  await api('/config/calendar', { method: 'PUT', body: JSON.stringify({ gistId }) })
}

// ─── Auth check ──────────────────────────────────────────────────────────────

export async function verifyAuth(): Promise<boolean> {
  try {
    const res = await apiFetch('/health')
    return res.ok
  } catch {
    return false
  }
}
