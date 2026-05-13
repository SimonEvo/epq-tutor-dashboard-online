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

// ─── Backup ───────────────────────────────────────────────────────────────────

export async function exportBackup(): Promise<{ path: string; students: number; supervisors: number; tags: number }> {
  return api('/backup/export', { method: 'POST' })
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

// ─── Zoom ─────────────────────────────────────────────────────────────────────

export async function fetchZoomMeetingSummary(
  meetingId: string,
  accountId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ summary_content: string; meeting_topic: string; meeting_start_time: string }> {
  return api('/zoom/meeting-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meeting_id: meetingId,
      account_id: accountId,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
}

export async function cancelZoomMeeting(
  meetingId: string,
  accountId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await api('/zoom/cancel-meeting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meeting_id: meetingId, account_id: accountId, client_id: clientId, client_secret: clientSecret }),
  })
}

export interface ZoomConflict {
  topic: string
  start: string  // HH:MM local time
  end: string    // HH:MM local time
}

export class ZoomConflictError extends Error {
  conflicts: ZoomConflict[]
  constructor(conflicts: ZoomConflict[]) {
    super('zoom_conflict')
    this.conflicts = conflicts
  }
}

export async function createZoomMeeting(params: {
  accountId: string
  clientId: string
  clientSecret: string
  topic: string
  startTime: string
  duration: number
  timezone: string
}): Promise<{ meetingId: string; joinUrl: string; password: string; startUrl: string }> {
  const res = await apiFetch(`${API_BASE_URL}/zoom/create-meeting`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      account_id: params.accountId,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      topic: params.topic,
      start_time: params.startTime,
      duration: params.duration,
      timezone: params.timezone,
    }),
  })
  if (res.status === 409) {
    const data = await res.json() as { detail: ZoomConflict[] }
    throw new ZoomConflictError(data.detail)
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { detail?: unknown }
    const msg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
    throw new Error(msg ?? `API error ${res.status}`)
  }
  return res.json() as Promise<{ meetingId: string; joinUrl: string; password: string; startUrl: string }>
}
