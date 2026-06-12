from sqlalchemy import (
    Column, String, Integer, Float, Text, DateTime, Enum, JSON, Boolean,
    ForeignKey, PrimaryKeyConstraint, UniqueConstraint
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.database import Base


def now_utc():
    return datetime.now(timezone.utc)


class Tutor(Base):
    __tablename__ = "tutors"
    id = Column(String(64), primary_key=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    default_round = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=now_utc)
    students = relationship("Student", back_populates="tutor")


class Supervisor(Base):
    __tablename__ = "supervisors"
    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    gender = Column(String(16))
    education = Column(String(128))
    background = Column(Text)
    direction = Column(Text)
    notes = Column(Text)
    sa_type = Column(String(32))
    created_at = Column(DateTime, default=now_utc)
    students = relationship("Student", back_populates="supervisor")


class Student(Base):
    __tablename__ = "students"
    id = Column(String(64), primary_key=True)
    tutor_id = Column(String(64), ForeignKey("tutors.id"), nullable=False)
    name = Column(String(128), nullable=False)
    name_en = Column(String(128))
    gender = Column(String(16))
    school = Column(String(256))
    submission_round = Column(String(64))
    taught_element_type = Column(String(128))
    university_aspiration = Column(String(256))
    current_grade = Column(String(32))
    university_enrollment = Column(String(32))
    contact = Column(String(256))
    supervisor_id = Column(String(64), ForeignKey("supervisors.id"))
    topic = Column(Text, nullable=False, default="")
    topic_zh = Column(Text, nullable=True, default="")
    overview = Column(Text)
    sa_hours_total = Column(Integer, default=12)
    sa_hours_used = Column(Float, default=0)
    next_sa_session = Column(String(16))
    next_ta_session = Column(String(16))
    next_theory_session = Column(String(16))
    availability_note = Column(Text, default="")
    brief_note = Column(Text, default="")
    schedule_entries = Column(JSON, default=list)
    private_notes = Column(Text, default="")
    tencent_doc_url = Column(String(512))
    ai_alias = Column(String(128))
    generated_progress_report = Column(Text)
    progress_report_generated_at = Column(String(32))
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)

    tutor = relationship("Tutor", back_populates="students")
    supervisor = relationship("Supervisor", back_populates="students")
    sessions = relationship("Session", back_populates="student", cascade="all, delete-orphan")
    milestones = relationship("StudentMilestone", back_populates="student", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary="student_tags")
    personal_entries = relationship("PersonalEntry", back_populates="student", cascade="all, delete-orphan")
    mind_maps = relationship("MindMap", back_populates="student", cascade="all, delete-orphan")
    homework_entries = relationship("HomeworkEntry", back_populates="student", cascade="all, delete-orphan")


class Session(Base):
    __tablename__ = "sessions"
    id = Column(String(64), primary_key=True)
    student_id = Column(String(64), ForeignKey("students.id"), nullable=False)
    type = Column(Enum("SA_MEETING", "TA_MEETING", "THEORY"), nullable=False)
    date = Column(String(16), nullable=False)
    time = Column(String(8))
    duration_minutes = Column(Integer, default=60)
    title = Column(String(128))
    summary = Column(Text, default="")
    homework = Column(Text, default="")
    transcript = Column(Text, default="")
    private_notes = Column(Text, default="")
    generated_report = Column(Text)
    report_generated_at = Column(String(32))
    zoom_meeting_id = Column(String(64))
    zoom_join_url = Column(Text)
    zoom_password = Column(String(64))
    created_at = Column(DateTime, default=now_utc)
    student = relationship("Student", back_populates="sessions")


class StudentMilestone(Base):
    __tablename__ = "student_milestones"
    student_id = Column(String(64), ForeignKey("students.id"), nullable=False)
    milestone_id = Column(String(32), nullable=False)
    status = Column(
        Enum("not_started", "in_progress", "completed", "na"),
        nullable=False,
        default="not_started"
    )
    __table_args__ = (PrimaryKeyConstraint("student_id", "milestone_id"),)
    student = relationship("Student", back_populates="milestones")


class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), nullable=False)
    __table_args__ = (UniqueConstraint("name"),)


class StudentTag(Base):
    __tablename__ = "student_tags"
    student_id = Column(String(64), ForeignKey("students.id"), nullable=False)
    tag_id = Column(Integer, ForeignKey("tags.id"), nullable=False)
    __table_args__ = (PrimaryKeyConstraint("student_id", "tag_id"),)


class PersonalEntry(Base):
    __tablename__ = "personal_entries"
    id = Column(String(64), primary_key=True)
    student_id = Column(String(64), ForeignKey("students.id"), nullable=False)
    date = Column(String(16), nullable=False)
    title = Column(String(256), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(String(32), nullable=False)
    student = relationship("Student", back_populates="personal_entries")


class MindMap(Base):
    __tablename__ = "mind_maps"
    id = Column(String(64), primary_key=True)
    student_id = Column(String(64), ForeignKey("students.id"), nullable=False)
    date = Column(String(16), nullable=False)
    title = Column(String(256), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(String(32), nullable=False)
    student = relationship("Student", back_populates="mind_maps")


class HomeworkEntry(Base):
    __tablename__ = "homework_entries"
    id = Column(String(64), primary_key=True)
    student_id = Column(String(64), ForeignKey("students.id"), nullable=False)
    session_id = Column(String(64), nullable=True)
    date = Column(String(16), nullable=False)
    source_label = Column(String(256), nullable=False)
    deadline = Column(String(16), nullable=True)
    items = Column(JSON, nullable=False, default=list)
    comments = Column(Text, default="")
    created_at = Column(String(32), nullable=False)
    student = relationship("Student", back_populates="homework_entries")


class WeeklyReport(Base):
    __tablename__ = "weekly_reports"
    id = Column(Integer, primary_key=True, autoincrement=True)
    generated_at = Column(String(32), nullable=False)
    content = Column(Text, nullable=False)
    last_scan_at = Column(String(32), nullable=False)
    student_cache = Column(JSON, nullable=False, default=dict)


class Round(Base):
    __tablename__ = "rounds"
    name = Column(String(128), primary_key=True)
    is_archived = Column(Boolean, default=False, nullable=False)


class ActionLog(Base):
    __tablename__ = "action_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=now_utc, nullable=False, index=True)
    action = Column(String(32), nullable=False)        # create | update | delete | ai_generate
    entity_type = Column(String(32), nullable=False)   # student | session | trial | ...
    entity_id = Column(String(64), default="")
    action_metadata = Column(JSON, default=dict)


class ManualLog(Base):
    __tablename__ = "manual_logs"
    id = Column(String(64), primary_key=True)
    occurred_at = Column(DateTime, nullable=False, index=True)
    description = Column(Text, nullable=False)
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)


class WorkflowAnalysis(Base):
    __tablename__ = "workflow_analyses"
    id = Column(Integer, primary_key=True, autoincrement=True)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    status = Column(String(16), default="pending", nullable=False)  # pending | generated
    content = Column(Text, default="")
    generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_utc)


class Trial(Base):
    __tablename__ = "trials"
    id = Column(String(64), primary_key=True)
    date = Column(String(16), nullable=False)
    time = Column("time", String(8), nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    student_name = Column(String(128), nullable=False, default="")
    grade = Column(String(16), default="")
    intended_major = Column(String(256), default="")
    target_university = Column(String(256), default="")
    areas_of_interest = Column(String(512), default="")
    english_level = Column(String(128), default="")
    trial_topic = Column(String(512), default="")
    topic_feasibility = Column(Integer, nullable=True)
    student_motivation = Column(Integer, nullable=True)
    epq_interest = Column(Integer, nullable=True)
    epq_suitability = Column(Integer, nullable=True)
    enrollment_intention = Column(String(8), default="")
    feedback_for_student = Column(Text, default="")
    feedback_for_consultant = Column(Text, default="")
    retrospective = Column(Text, default="")
    outcome = Column(String(16), default="pending")
    linked_student_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)


class GanttProject(Base):
    __tablename__ = "gantt_projects"
    id = Column(String(64), primary_key=True)
    tutor_id = Column(String(64), ForeignKey("tutors.id"), nullable=False)
    owner_type = Column(String(16), nullable=False)  # 'tutor' | 'student'
    owner_id = Column(String(64), nullable=True)     # null when owner_type = 'tutor'
    name = Column(String(128), nullable=False, default="")
    data = Column(JSON, default=dict)                # {projectName, sections, tasks}
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)

    __table_args__ = (
        UniqueConstraint('tutor_id', 'owner_type', 'owner_id', name='uq_gantt_project_owner'),
    )
