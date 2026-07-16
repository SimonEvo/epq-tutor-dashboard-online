import { apiFetch } from './githubClient'
import { API_BASE_URL } from '@/config'
import type { Student, Supervisor, WeeklyReportData, Trial, ActionLog, ManualLog, WorkflowAnalysis, GanttProject, GanttProjectSummary } from '@/types'

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

export async function patchStudentAlias(id: string, aiAlias: string): Promise<void> {
  await api(`/students/${id}/ai_alias`, { method: 'PATCH', body: JSON.stringify({ aiAlias }) })
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

export async function getDefaultRound(): Promise<string> {
  try {
    const res = await api<{ defaultRound: string }>('/config/default-round')
    return res.defaultRound || ''
  } catch {
    return ''
  }
}

export async function setDefaultRound(round: string): Promise<void> {
  await api('/config/default-round', { method: 'PUT', body: JSON.stringify({ defaultRound: round }) })
}

export interface ArchivedRound {
  name: string
  studentCount: number
  students: { id: string; name: string; nameEn?: string }[]
}

export async function getArchivedRounds(): Promise<ArchivedRound[]> {
  try { return await api<ArchivedRound[]>('/config/rounds/archived') }
  catch { return [] }
}

export async function archiveRound(name: string): Promise<void> {
  await api(`/config/rounds/${encodeURIComponent(name)}/archive`, { method: 'POST' })
}

export async function unarchiveRound(name: string): Promise<void> {
  await api(`/config/rounds/${encodeURIComponent(name)}/unarchive`, { method: 'POST' })
}

export function downloadRoundExport(name: string, token: string): void {
  const url = `${API_BASE_URL}/config/rounds/${encodeURIComponent(name)}/export`
  const a = document.createElement('a')
  a.href = url
  // Use fetch with auth header, then trigger download
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.blob())
    .then(blob => {
      const href = URL.createObjectURL(blob)
      a.href = href
      a.download = `${name}.json`
      a.click()
      URL.revokeObjectURL(href)
    })
}

/** 下载全部数据的完整快照到本地（单个 JSON 文件）。 */
export async function downloadLocalBackup(token: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/backup/download`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`下载失败：${res.status}`)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = `epq-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(href)
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

export async function listBackups(): Promise<{ date: string; students: number; supervisors: number }[]> {
  return api('/backup/list')
}

export async function restoreBackup(date: string): Promise<{ ok: boolean; restored: { students: number; supervisors: number; tags: number } }> {
  return api(`/backup/restore/${date}`, { method: 'POST' })
}

/** 从本地上传的完整 JSON 快照恢复数据。 */
export async function restoreLocalBackup(file: File): Promise<{ ok: boolean; restored: { students: number; supervisors: number; tags: number } }> {
  let snapshot: unknown
  try {
    snapshot = JSON.parse(await file.text())
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  return api('/backup/restore-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
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

// ── Student Knowledge Base ─────────────────────────────────────────────────────

export type KbSource =
  | 'sessions' | 'sa_hours' | 'meeting_dates' | 'milestones' | 'schedule_entries'
  | 'submission_round' | 'profile' | 'private_notes' | 'homework' | 'gantt_events'

export type KbSourceToggles = Record<KbSource, boolean>

export interface KnowledgeEntry {
  id: string
  content: string
  source: 'manual' | 'wechat' | 'ai'
  createdAt: string
  digestedAt: string | null
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Layer 1: assembled structured context (REAL names — encoding happens at the
// AI boundary in kbChat/kbDigest/kbMerge, never client-side for KB).
export async function getKbContext(studentId: string): Promise<{ context: string; charCount: number }> {
  return api(`/students/${studentId}/kb-context`)
}

// Layer 2: Living Summary
export async function getLivingSummary(studentId: string): Promise<{ content: string; updatedAt: string }> {
  return api(`/students/${studentId}/living-summary`)
}

export async function putLivingSummary(
  studentId: string, content: string, digestedEntryIds: string[] = [],
): Promise<{ content: string; updatedAt: string }> {
  return api(`/students/${studentId}/living-summary`, {
    method: 'PUT',
    body: JSON.stringify({ content, digestedEntryIds }),
  })
}

// Layer 3: Raw entries
export async function getKnowledgeEntries(studentId: string, all = false): Promise<KnowledgeEntry[]> {
  return api(`/students/${studentId}/knowledge-entries${all ? '?all=true' : ''}`)
}

export async function addKnowledgeEntry(
  studentId: string, content: string, source: KnowledgeEntry['source'] = 'manual',
): Promise<KnowledgeEntry> {
  return api(`/students/${studentId}/knowledge-entries`, {
    method: 'POST',
    body: JSON.stringify({ content, source }),
  })
}

export async function deleteKnowledgeEntry(studentId: string, entryId: string): Promise<void> {
  await api(`/students/${studentId}/knowledge-entries/${entryId}`, { method: 'DELETE' })
}

// Multi-turn chat — the single AI boundary (server encodes/decodes names).
export async function kbChat(
  studentId: string, messages: ChatMessage[],
  ai: { apiKey: string; model: string; baseUrl: string },
): Promise<{ content: string }> {
  return api('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({
      studentId, messages,
      apiKey: ai.apiKey, model: ai.model, baseUrl: ai.baseUrl,
    }),
  })
}

// Digest: propose durable facts (not persisted).
export async function kbDigest(
  studentId: string, messages: ChatMessage[],
  ai: { apiKey: string; model: string; baseUrl: string },
): Promise<{ proposals: string[]; rawReply: string | null; entryIds: string[] }> {
  return api(`/students/${studentId}/kb-digest`, {
    method: 'POST',
    body: JSON.stringify({ messages, apiKey: ai.apiKey, model: ai.model, baseUrl: ai.baseUrl }),
  })
}

// Merge approved facts into the summary — returns a preview (not persisted).
export async function kbMerge(
  studentId: string, approvedFacts: string[],
  ai: { apiKey: string; model: string; baseUrl: string },
): Promise<{ merged: string; previous: string }> {
  return api(`/students/${studentId}/living-summary/merge`, {
    method: 'POST',
    body: JSON.stringify({ approvedFacts, apiKey: ai.apiKey, model: ai.model, baseUrl: ai.baseUrl }),
  })
}

// Global source toggles (Settings)
export async function getKbSources(): Promise<KbSourceToggles> {
  const res = await api<{ sources: KbSourceToggles }>('/config/kb-sources')
  return res.sources
}

export async function putKbSources(sources: KbSourceToggles): Promise<KbSourceToggles> {
  const res = await api<{ sources: KbSourceToggles }>('/config/kb-sources', {
    method: 'PUT',
    body: JSON.stringify({ sources }),
  })
  return res.sources
}

// ── Gantt ─────────────────────────────────────────────────────────────────────

export async function getGanttProjects(): Promise<GanttProjectSummary[]> {
  return api<GanttProjectSummary[]>('/gantt/projects')
}

export async function getGanttProject(ownerType: string, ownerId: string): Promise<GanttProject | null> {
  const res = await apiFetch(`/api/gantt/projects/${ownerType}/${ownerId}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json() as Promise<GanttProject>
}

export async function upsertGanttProject(ownerType: string, ownerId: string, name: string, data: object): Promise<GanttProject> {
  return api<GanttProject>(`/gantt/projects/${ownerType}/${ownerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data }),
  })
}
