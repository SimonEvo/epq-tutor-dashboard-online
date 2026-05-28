export type SessionType = 'SA_MEETING' | 'TA_MEETING' | 'THEORY'

export interface Supervisor {
  id: string
  name: string
  gender?: string
  education?: string
  background?: string
  direction?: string
  notes?: string
  saType?: '英方SA' | '中方SA'  // defaults to 英方SA when unset
}

export interface PersonalEntry {
  id: string
  date: string   // YYYY-MM-DD
  title: string  // topic/theme
  content: string // markdown
  createdAt: string
}

export interface MindMap {
  id: string
  date: string      // YYYY-MM-DD
  title: string
  content: string   // markdown — rendered by markmap
  createdAt: string
}

export interface HomeworkItem {
  text: string
  done: boolean
}

export interface HomeworkEntry {
  id: string
  date: string         // 留作业日期 YYYY-MM-DD（卡片标题）
  sourceLabel: string  // "SA #3 · 2024-03-15"
  sessionId: string
  deadline?: string
  items: HomeworkItem[]
  comments: string
  createdAt: string
}

export type MilestoneStatus = 'not_started' | 'in_progress' | 'completed' | 'na'

export interface SessionRecord {
  id: string
  type: SessionType
  date: string // ISO date string YYYY-MM-DD
  time?: string // HH:MM
  durationMinutes: number
  title?: string  // e.g. "SA #3" — auto-generated at creation, editable
  summary: string
  homework: string
  transcript: string
  privateNotes: string
  createdAt: string
  generatedReport?: string   // cached AI-generated parent report
  reportGeneratedAt?: string // ISO timestamp of when it was generated
  zoomMeetingId?: string
  zoomJoinUrl?: string
  zoomPassword?: string
}

export interface MilestoneProgress {
  [key: string]: MilestoneStatus // MilestoneId -> status
}

export interface Student {
  latestHomeworkEntry?: HomeworkEntry
  id: string
  name: string
  nameEn?: string
  gender?: string
  school?: string
  submissionRound?: string
  taughtElementType?: string
  universityAspiration?: string
  currentGrade?: string
  universityEnrollment?: string
  contact?: string
  supervisorId?: string
  topic: string
  topicZh?: string
  overview?: string
  personalEntries: PersonalEntry[]
  mindMaps: MindMap[]
  homeworkEntries: HomeworkEntry[]
  tags: string[]
  saHoursTotal: number      // SA hour quota
  saHoursUsed: number       // auto-computed from SA session records
  nextSaSession?: string    // ISO date string
  nextTaSession?: string    // ISO date string
  nextTheorySession?: string // ISO date string
  availabilityNote: string  // e.g. "Exam prep until June"
  briefNote: string         // one-liner shown on card
  privateNotes: string      // never exported
  tencentDocUrl?: string    // shared Tencent Doc URL for this student's WeChat group
  milestones: MilestoneProgress
  sessions: SessionRecord[]
  generatedProgressReport?: string    // cached AI-generated progress report
  progressReportGeneratedAt?: string  // ISO timestamp of when it was generated
  createdAt: string
  updatedAt: string
}

export interface StudentSummary {
  id: string
  name: string
  topic: string
  topicZh?: string
  tags: string[]
  saHoursTotal: number
  saHoursUsed: number
  nextSaSession?: string
  nextTaSession?: string
  nextTheorySession?: string
  availabilityNote: string
  briefNote: string
  lastSessionDate?: string
  lastSessionType?: SessionType
  milestones: MilestoneProgress
}

// Global tag library stored in config/tags.json
export interface TagsConfig {
  tags: string[]
}

// ─── Weekly Report ────────────────────────────────────────────────────────────

export interface StudentReportCacheEntry {
  updatedAt: string  // snapshot of student.updatedAt at last scan
  alias: string      // e.g. "学生A" — stable across scans
}

export interface ActionLog {
  id: number
  timestamp: string
  action: 'create' | 'update' | 'delete' | 'ai_generate'
  entityType: string
  entityId: string
  metadata: Record<string, unknown>
}

export interface ManualLog {
  id: string
  occurredAt: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowAnalysis {
  id: number
  periodStart: string
  periodEnd: string
  status: 'pending' | 'generated'
  content: string
  generatedAt: string | null
  createdAt: string
}

export type TrialOutcome = 'pending' | 'no_deal' | 'deal_mine' | 'deal_other'
export type TrialDurationCategory = '<45' | '46-60' | '61-75' | '>75' | ''
export type TrialGrade = '高一' | '高二' | '高三' | '其他' | ''
export type TrialEnrollmentIntention = '低' | '中' | '高' | ''

export interface Trial {
  id: string
  date: string
  durationCategory: TrialDurationCategory
  studentName: string
  grade: TrialGrade
  intendedMajor: string
  targetUniversity: string
  areasOfInterest: string
  englishLevel: string
  trialTopic: string
  topicFeasibility: number | null
  studentMotivation: number | null
  epqInterest: number | null
  epqSuitability: number | null
  enrollmentIntention: TrialEnrollmentIntention
  feedbackForStudent: string
  feedbackForConsultant: string
  retrospective: string
  outcome: TrialOutcome
  linkedStudentId?: string
  createdAt: string
  updatedAt: string
}

export interface WeeklyReportData {
  generatedAt: string   // ISO timestamp
  content: string       // decoded report text (real names restored)
  cache: {
    lastScanAt: string
    students: Record<string, StudentReportCacheEntry>  // keyed by student id
  }
}
