import { apiFetch } from './githubClient'
import type { Student, SessionType } from '@/types'

export function calendarUrl(): string {
  return `${window.location.origin}/api/calendar.ics`
}

// ─── ICS formatting helpers ──────────────────────────────────────────────────

const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  SA_MEETING: 'SA Meeting',
  TA_MEETING: 'TA Meeting',
  THEORY: 'Taught Element',
}

function fold(line: string): string {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  let i = 75
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74))
    i += 74
  }
  return parts.join('\r\n')
}

function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function dtProp(name: 'DTSTART' | 'DTEND', date: string, time?: string): string {
  const d = date.replace(/-/g, '')
  if (time) {
    const t = time.replace(':', '') + '00'
    return fold(`${name};TZID=Asia/Shanghai:${d}T${t}`)
  }
  return `${name};VALUE=DATE:${d}`
}

function dtEndTimed(date: string, time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const totalMins = h * 60 + m + minutes
  const extraDays = Math.floor(totalMins / (24 * 60))
  const endH = Math.floor((totalMins % (24 * 60)) / 60)
  const endM = totalMins % 60
  let endDate = date
  if (extraDays > 0) {
    const obj = new Date(date + 'T00:00:00')
    obj.setDate(obj.getDate() + extraDays)
    endDate = obj.toISOString().slice(0, 10)
  }
  const d = endDate.replace(/-/g, '')
  const t = String(endH).padStart(2, '0') + String(endM).padStart(2, '0') + '00'
  return fold(`DTEND;TZID=Asia/Shanghai:${d}T${t}`)
}

function advanceDate(date: string, days = 1): string {
  const obj = new Date(date + 'T00:00:00')
  obj.setDate(obj.getDate() + days)
  return obj.toISOString().slice(0, 10).replace(/-/g, '')
}

function toStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function generateICS(students: Student[]): string {
  const now = toStamp(new Date().toISOString())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EPQ Tutor Dashboard//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:EPQ 辅导课程',
    'X-WR-TIMEZONE:Asia/Shanghai',
  ]

  for (const student of students) {
    const nameLabel = student.nameEn ? `${student.name} (${student.nameEn})` : student.name

    for (const session of student.sessions) {
      const typeLabel = SESSION_TYPE_LABEL[session.type]
      const summary = `${nameLabel} · ${session.title ?? typeLabel}`
      const description = `${SESSION_TYPE_LABEL[session.type]} · ${session.durationMinutes} min`
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:epq-session-${session.id}@epq-tutor-dashboard`)
      lines.push(`DTSTAMP:${now}Z`)
      lines.push(`CREATED:${session.createdAt ? toStamp(session.createdAt) : now}Z`)
      lines.push(dtProp('DTSTART', session.date, session.time))
      if (session.time) {
        lines.push(dtEndTimed(session.date, session.time, session.durationMinutes))
      } else {
        lines.push(`DTEND;VALUE=DATE:${advanceDate(session.date)}`)
      }
      lines.push(fold(`SUMMARY:${esc(summary)}`))
      lines.push(fold(`DESCRIPTION:${esc(description)}`))
      lines.push('END:VEVENT')
    }

    const existingSaDates = new Set(student.sessions.filter(s => s.type === 'SA_MEETING').map(s => s.date))
    const existingTaDates = new Set(student.sessions.filter(s => s.type === 'TA_MEETING').map(s => s.date))
    const existingTEDates = new Set(student.sessions.filter(s => s.type === 'THEORY').map(s => s.date))

    const planned: [string | undefined, string, Set<string>][] = [
      [student.nextSaSession, `${nameLabel} · 下次SA（计划中）`, existingSaDates],
      [student.nextTaSession, `${nameLabel} · 下次TA（计划中）`, existingTaDates],
      [student.nextTheorySession, `${nameLabel} · 下次Theory（计划中）`, existingTEDates],
    ]
    const plannedKeys = ['sa', 'ta', 'theory']
    planned.forEach(([dateStr, summary, existingDates], i) => {
      if (!dateStr || existingDates.has(dateStr)) return
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:epq-next-${plannedKeys[i]}-${student.id}@epq-tutor-dashboard`)
      lines.push(`DTSTAMP:${now}Z`)
      lines.push(`DTSTART;VALUE=DATE:${dateStr.replace(/-/g, '')}`)
      lines.push(`DTEND;VALUE=DATE:${advanceDate(dateStr)}`)
      lines.push(fold(`SUMMARY:${esc(summary)}`))
      lines.push('STATUS:TENTATIVE')
      lines.push('END:VEVENT')
    })
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// ─── Publish ─────────────────────────────────────────────────────────────────

export async function publishCalendar(students: Student[]): Promise<string> {
  const ics = generateICS(students)
  await apiFetch('/api/calendar', {
    method: 'PUT',
    body: JSON.stringify({ ics }),
  })
  return calendarUrl()
}

// Legacy compat — gistId is now always "backend"
export function gistUrl(_gistId: string): string {
  return calendarUrl()
}
