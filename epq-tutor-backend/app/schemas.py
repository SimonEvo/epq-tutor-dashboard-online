from pydantic import BaseModel
from typing import Optional


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Supervisor ────────────────────────────────────────────────────────────────

class SupervisorSchema(BaseModel):
    id: str
    name: str
    gender: Optional[str] = None
    education: Optional[str] = None
    background: Optional[str] = None
    direction: Optional[str] = None
    notes: Optional[str] = None
    saType: Optional[str] = None

    class Config:
        from_attributes = True


# ── Session ───────────────────────────────────────────────────────────────────

class SessionSchema(BaseModel):
    id: str
    type: str
    date: str
    time: Optional[str] = None
    durationMinutes: int = 60
    title: Optional[str] = None
    summary: str = ""
    homework: str = ""
    transcript: str = ""
    privateNotes: str = ""
    createdAt: str = ""
    generatedReport: Optional[str] = None
    reportGeneratedAt: Optional[str] = None
    reportExtraContext: Optional[str] = None
    feedbackSent: bool = False
    isFinalDefense: bool = False
    tutorAttending: bool = False
    zoomMeetingId: Optional[str] = None
    zoomJoinUrl: Optional[str] = None
    zoomPassword: Optional[str] = None

    class Config:
        from_attributes = True


# ── Milestone ─────────────────────────────────────────────────────────────────

MilestoneProgress = dict[str, str]  # milestone_id → status


# ── Student (full) ────────────────────────────────────────────────────────────

class StudentSchema(BaseModel):
    id: str
    name: str
    nameEn: Optional[str] = None
    gender: Optional[str] = None
    school: Optional[str] = None
    submissionRound: Optional[str] = None
    taughtElementType: Optional[str] = None
    universityAspiration: Optional[str] = None
    currentGrade: Optional[str] = None
    universityEnrollment: Optional[str] = None
    contact: Optional[str] = None
    supervisorId: Optional[str] = None
    topic: str = ""
    topicZh: str = ""
    overview: Optional[str] = None
    saHoursTotal: int = 12
    saHoursUsed: float = 0
    nextSaSession: Optional[str] = None
    nextTaSession: Optional[str] = None
    nextTheorySession: Optional[str] = None
    availabilityNote: str = ""
    briefNote: str = ""
    privateNotes: str = ""
    tencentDocUrl: Optional[str] = None
    scheduleEntries: list[dict] = []
    milestones: MilestoneProgress = {}
    tags: list[str] = []
    sessions: list[SessionSchema] = []
    personalEntries: list[dict] = []
    mindMaps: list[dict] = []
    homeworkEntries: list[dict] = []
    generatedProgressReport: Optional[str] = None
    progressReportGeneratedAt: Optional[str] = None
    aiAlias: Optional[str] = None
    # ── 提交（read-only here; written via narrow PATCH endpoints）────────────
    submissionChecklist: dict = {}
    tiiChecks: list[dict] = []
    deadlineTier: str = "normal"
    deadlineOverride: Optional[str] = None
    deadlineChangeConfirmed: bool = False
    effectiveDeadline: Optional[str] = None
    deadlineNeedsConfirm: bool = False
    wrappedUpAt: Optional[str] = None
    defenseConfirmed: bool = False
    createdAt: str = ""
    updatedAt: str = ""


# ── StudentSummary (list view, no privateNotes) ───────────────────────────────

class SessionSummarySchema(BaseModel):
    id: str
    type: str
    date: str
    time: Optional[str] = None
    durationMinutes: int = 60
    feedbackSent: bool = False
    isFinalDefense: bool = False
    tutorAttending: bool = False


class StudentSummarySchema(BaseModel):
    id: str
    name: str
    topic: str
    topicZh: str = ""
    tags: list[str] = []
    saHoursTotal: int
    saHoursUsed: float
    nextSaSession: Optional[str] = None
    nextTaSession: Optional[str] = None
    nextTheorySession: Optional[str] = None
    availabilityNote: str = ""
    briefNote: str = ""
    latestScheduleEntry: Optional[dict] = None
    lastSessionDate: Optional[str] = None
    lastSessionType: Optional[str] = None
    milestones: MilestoneProgress = {}
    submissionRound: Optional[str] = None
    supervisorId: Optional[str] = None
    nameEn: Optional[str] = None
    overview: Optional[str] = None
    sessions: list[SessionSummarySchema] = []
    updatedAt: str = ""
    latestHomeworkEntry: Optional[dict] = None
    aiAlias: Optional[str] = None
    # ── 提交（read-only here; written via narrow PATCH endpoints）────────────
    submissionChecklist: dict = {}
    tiiChecks: list[dict] = []
    deadlineTier: str = "normal"
    deadlineOverride: Optional[str] = None
    deadlineChangeConfirmed: bool = False
    effectiveDeadline: Optional[str] = None
    deadlineNeedsConfirm: bool = False
    wrappedUpAt: Optional[str] = None
    defenseConfirmed: bool = False


# ── Tags ──────────────────────────────────────────────────────────────────────

class TagsConfig(BaseModel):
    tags: list[str]


# ── Workflow Analysis ─────────────────────────────────────────────────────────

class ActionLogSchema(BaseModel):
    id: int
    timestamp: str
    action: str
    entityType: str
    entityId: str = ""
    metadata: dict = {}


class ManualLogSchema(BaseModel):
    id: str
    occurredAt: str
    description: str
    createdAt: str = ""
    updatedAt: str = ""


class WorkflowAnalysisSchema(BaseModel):
    id: int
    periodStart: str
    periodEnd: str
    status: str  # pending | generated
    content: str = ""
    generatedAt: Optional[str] = None
    createdAt: str = ""


class WorkflowAnalysisUpdateSchema(BaseModel):
    content: str


# ── Trial (试听课) ────────────────────────────────────────────────────────────

class TrialSchema(BaseModel):
    id: str
    date: str
    time: str = ""
    durationMinutes: Optional[int] = None
    studentName: str = ""
    grade: str = ""
    intendedMajor: str = ""
    targetUniversity: str = ""
    areasOfInterest: str = ""
    englishLevel: str = ""
    trialTopic: str = ""
    topicFeasibility: Optional[int] = None
    studentMotivation: Optional[int] = None
    epqInterest: Optional[int] = None
    epqSuitability: Optional[int] = None
    enrollmentIntention: str = ""
    feedbackForStudent: str = ""
    feedbackForConsultant: str = ""
    retrospective: str = ""
    outcome: str = "pending"
    linkedStudentId: Optional[str] = None
    createdAt: str = ""
    updatedAt: str = ""

    class Config:
        from_attributes = True


class ScheduleEventSchema(BaseModel):
    id: str
    title: str = ""
    date: str
    time: str
    durationMinutes: int = 60
    note: str = ""
    link: str = ""
    countsAsOvertime: bool = False
    createdAt: str = ""
    updatedAt: str = ""

    class Config:
        from_attributes = True


# ── Weekly report ─────────────────────────────────────────────────────────────

class WeeklyReportSchema(BaseModel):
    generatedAt: str
    content: str
    cache: dict


# ── Student Knowledge Base ────────────────────────────────────────────────────

class LivingSummarySchema(BaseModel):
    """Layer 2 — evolving per-student understanding."""
    content: str = ""
    updatedAt: str = ""


class LivingSummaryUpdateSchema(BaseModel):
    content: str
    # When set, these raw entries are marked digested atomically with the save.
    digestedEntryIds: list[str] = []


class KnowledgeEntrySchema(BaseModel):
    """Layer 3 — one raw inbox item."""
    id: str
    content: str
    source: str = "manual"  # manual | wechat | ai
    createdAt: str = ""
    digestedAt: Optional[str] = None


class KnowledgeEntryCreateSchema(BaseModel):
    content: str
    source: str = "manual"


# ── 提交前检查清单模板 ─────────────────────────────────────────────────────────

class ChecklistItemSchema(BaseModel):
    id: str
    label: str
    order: int = 0
    archived: bool = False


class ChecklistTemplateSchema(BaseModel):
    items: list[ChecklistItemSchema] = []


class RoundDeadlinesSchema(BaseModel):
    normal: Optional[str] = None
    extended: Optional[str] = None
