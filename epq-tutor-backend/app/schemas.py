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
    milestones: MilestoneProgress = {}
    tags: list[str] = []
    sessions: list[SessionSchema] = []
    personalEntries: list[dict] = []
    mindMaps: list[dict] = []
    homeworkEntries: list[dict] = []
    generatedProgressReport: Optional[str] = None
    progressReportGeneratedAt: Optional[str] = None
    createdAt: str = ""
    updatedAt: str = ""


# ── StudentSummary (list view, no privateNotes) ───────────────────────────────

class SessionSummarySchema(BaseModel):
    id: str
    type: str
    date: str
    durationMinutes: int = 60


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
    durationCategory: str = ""
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


# ── Weekly report ─────────────────────────────────────────────────────────────

class WeeklyReportSchema(BaseModel):
    generatedAt: str
    content: str
    cache: dict
