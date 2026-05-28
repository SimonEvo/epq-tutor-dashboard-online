import { apiFetch } from './githubClient'
import { API_BASE_URL } from '@/config'
import type { Student, Supervisor, WeeklyReportData, Trial, ActionLog, ManualLog, WorkflowAnalysis } from '@/types'

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

export async function toggleHomeworkItem(
  studentId: string,
  entryId: string,
  itemIdx: number,
  done: boolean,
): Promise<void> {
  await api(`/students/${studentId}/homework/${entryId}/item/${itemIdx}`, {
    method: 'PATCH',
    body: JSON.stringify({ done }),
  })
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

// ─── Trials ───────────────────────────────────────────────────────────────────

export async function listTrials(): Promise<Trial[]> {
  return api<Trial[]>('/trials')
}

export async function saveTrial(trial: Trial): Promise<Trial> {
  return api<Trial>(`/trials/${trial.id}`, { method: 'PUT', body: JSON.stringify(trial) })
}

export async function createTrial(trial: Trial): Promise<Trial> {
  return api<Trial>('/trials', { method: 'POST', body: JSON.stringify(trial) })
}

export async function deleteTrial(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/trials/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}

// ─── Workflow Analysis ────────────────────────────────────────────────────────

export async function listActionLogs(since?: string, until?: string): Promise<ActionLog[]> {
  const params = new URLSearchParams()
  if (since) params.set('since', since)
  if (until) params.set('until', until)
  const qs = params.toString()
  return api<ActionLog[]>(`/workflow/action-logs${qs ? `?${qs}` : ''}`)
}

export async function listManualLogs(): Promise<ManualLog[]> {
  return api<ManualLog[]>('/workflow/manual-logs')
}

export async function createManualLog(log: ManualLog): Promise<ManualLog> {
  return api<ManualLog>('/workflow/manual-logs', { method: 'POST', body: JSON.stringify(log) })
}

export async function updateManualLog(log: ManualLog): Promise<ManualLog> {
  return api<ManualLog>(`/workflow/manual-logs/${log.id}`, { method: 'PUT', body: JSON.stringify(log) })
}

export async function deleteManualLog(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/workflow/manual-logs/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}

export async function listWorkflowAnalyses(): Promise<WorkflowAnalysis[]> {
  return api<WorkflowAnalysis[]>('/workflow/analyses')
}

export async function getPendingAnalysis(): Promise<WorkflowAnalysis | null> {
  try {
    return await api<WorkflowAnalysis | null>('/workflow/analyses/pending')
  } catch {
    return null
  }
}

export async function fillAnalysis(id: number, content: string): Promise<WorkflowAnalysis> {
  return api<WorkflowAnalysis>(`/workflow/analyses/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
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
