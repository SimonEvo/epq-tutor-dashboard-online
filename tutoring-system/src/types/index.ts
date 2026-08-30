export type SessionType = 'SA_MEETING' | 'TA_MEETING' | 'THEORY'

export type ScheduleEntryType = 'exam' | 'holiday' | 'other'

export interface ScheduleEntry {
  id: string
  recordedAt: string   // YYYY-MM-DD
  content: string
  type?: ScheduleEntryType
  startDate?: string
  endDate?: string
}

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
  reportExtraContext?: string // 生成报告时的额外补充（督导反馈／导师补充）
  feedbackSent?: boolean       // SA 会议课后反馈是否已发送（首次生成 AI 报告时自动置 true）
  isFinalDefense?: boolean     // 标记为最终答辩的特殊 SA 会议（不计 SA 课时；甘特图红框标识）
  tutorAttending?: boolean     // 英方SA会议：导师是否出席（决定日程视图颜色是否恢复正常）
  zoomMeetingId?: string
  zoomJoinUrl?: string
  zoomPassword?: string
}

export interface MilestoneProgress {
  [key: string]: MilestoneStatus // MilestoneId -> status
}


// ─── 提交前检查清单 / 提交截止时间 / 结项 ──────────────────────────────────────

/** 模板项。模板是活定义：学生只存打钩状态，模板一改所有学生跟着变。 */
export interface ChecklistTemplateItem {
  id: string
  label: string
  order: number
  archived: boolean
}

/** 表13证据的一条。前两条（论文/报告、PPT的PDF）是所有学生共有的固定项，不可删。 */
export interface ChecklistCustomItem {
  id: string
  label: string
  done: boolean
  doneAt?: string
  fixed?: boolean   // 服务端标记：固定项，前端不给删除按钮
}

export interface SubmissionChecklist {
  ticked: Record<string, string>   // itemId -> 打钩时间 ISO
  customItems: ChecklistCustomItem[]
}

/** 一次论文检测记录。AI 率 / 相似度允许留空。 */
export interface TiiCheck {
  id?: string
  date: string
  aiPercent?: number | null
  similarityPercent?: number | null
  note?: string
}

export type DeadlineTier = 'normal' | 'extended'

export interface RoundDeadlines {
  normal?: string | null
  extended?: string | null
}

/** 提交相关字段，Student 与 StudentSummary 共用 */
export interface SubmissionFields {
  submissionChecklist?: SubmissionChecklist
  tiiChecks?: TiiCheck[]
  deadlineTier?: DeadlineTier
  deadlineOverride?: string | null
  deadlineChangeConfirmed?: boolean
  effectiveDeadline?: string | null   // 服务端算好：override ?? round[tier]；null = 待定
  deadlineNeedsConfirm?: boolean      // 需要运营确认但尚未确认 → ⚠
  wrappedUpAt?: string | null         // 结项时间戳；仅影响呈现
  defenseConfirmed?: boolean          // 最终答辩时间已跟学生确认（日期取自 isFinalDefense 的 session）
}

export interface Student extends SubmissionFields {
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
  aiAlias?: string          // anonymisation alias used when sending data to AI
  tencentDocUrl?: string    // shared Tencent Doc URL for this student's WeChat group
  scheduleEntries: ScheduleEntry[]
  latestScheduleEntry?: ScheduleEntry
  milestones: MilestoneProgress
  sessions: SessionRecord[]
  generatedProgressReport?: string    // cached AI-generated progress report
  progressReportGeneratedAt?: string  // ISO timestamp of when it was generated
  createdAt: string
  updatedAt: string
}

export interface StudentSummary extends SubmissionFields {
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
  latestScheduleEntry?: ScheduleEntry
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
  updatedAt: string
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
export type TrialGrade = '高一' | '高二' | '高三' | '其他' | ''
export type TrialEnrollmentIntention = '低' | '中' | '高' | ''

export interface Trial {
  id: string
  date: string
  time: string
  durationMinutes: number | null
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

export interface ScheduleEvent {
  id: string
  title: string
  date: string          // YYYY-MM-DD
  time: string          // HH:MM — required
  durationMinutes: number
  note: string
  link: string
  /** 「加个班儿」——非学生会议的加班项目，true 才进加班申请统计 */
  countsAsOvertime: boolean
  createdAt: string
  updatedAt: string
}

export interface GanttTask {
  id: string
  name: string
  startDate: string
  endDate: string
  milestone: boolean
  color?: string
  assignee?: string
  sectionId?: string | null
  notes?: string
  progress?: number
  dependencies?: string[]
}

export interface GanttProjectData {
  projectName: string
  sections: Array<{ id: string; name: string; collapsed?: boolean }>
  tasks: GanttTask[]
}

export interface GanttProject {
  ownerType: string
  ownerId: string | null
  name: string
  data: GanttProjectData
}

export interface GanttProjectSummary {
  ownerType: string
  ownerId: string | null
  name: string
}

export interface WeeklyReportData {
  generatedAt: string   // ISO timestamp
  content: string       // decoded report text (real names restored)
  cache: {
    lastScanAt: string
    students: Record<string, StudentReportCacheEntry>  // keyed by student id
  }
}

// ── 群催促提醒（企业微信机器人） ───────────────────────────────────────────
export interface NagScan {
  date: string
  weekday: string
  stale_threshold: number
  groups: {
    unscheduled_sa: { name: string; topic: string }[]
    stale: { name: string; topic: string; stale_days: number | null; next_sa: string }[]
    upcoming_sa: { name: string; topic: string; next_sa: string; when: string; days_until: number }[]
  }
  events: { title: string; when: string }[]
  total: number
}

export interface NagPreview {
  scan: NagScan
  messages: string[]          // 规则版 markdown 分条
  webhookConfigured: boolean
}

export interface NagPushResult {
  total: number
  messages: number
  push: { sent: number; failed: number; skipped: boolean; errors: string[] }
}
