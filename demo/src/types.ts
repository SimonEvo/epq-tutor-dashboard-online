export type SessionType = 'SA_MEETING' | 'TA_MEETING' | 'THEORY'

export interface HomeworkItem {
  label: string
  done: boolean
}

export interface Session {
  id: string
  date: string // YYYY-MM-DD
  type: SessionType
  durationMinutes: number
  summary: string
  homework: HomeworkItem[]
}

export type MilestoneStatus = 'not_started' | 'in_progress' | 'completed' | 'na'
export type DeadlineTier = 'normal' | 'extended'
export type SaKind = 'chinese' | 'british' // 中方SA / 英方SA

export interface TiiCheck {
  date: string
  aiPercent: number | null
  similarityPercent: number | null
  note: string
}

export interface GanttBar {
  label: string
  start: string // YYYY-MM-DD
  end: string
}

export interface GanttDiamond {
  label: string
  date: string
}

export interface Student {
  id: string
  name: string
  englishName: string
  overview: string // 课题短语
  topic: string // 完整课题
  briefNote: string
  round: string
  saKind: SaKind
  saHoursTotal: number
  deadlineTier: DeadlineTier
  deadlineOverride: string | null // YYYY-MM-DDTHH:mm
  wrappedUp: boolean
  milestones: Record<string, MilestoneStatus>
  sessions: Session[]
  nextSA: string | null
  nextTA: string | null
  scheduleNote: string // 最近一条 schedule entry
  tiiChecks: TiiCheck[]
  checklist: string[] // ticked template item ids
  ganttBars: GanttBar[]
  ganttDiamonds: GanttDiamond[]
}

export interface RoundInfo {
  name: string
  deadlineNormal: string // YYYY-MM-DDTHH:mm
  deadlineExtended: string
  archived?: boolean
}

export type Page =
  | { kind: 'dashboard' }
  | { kind: 'student'; id: string }
  | { kind: 'gantt' }
  | { kind: 'report' }
