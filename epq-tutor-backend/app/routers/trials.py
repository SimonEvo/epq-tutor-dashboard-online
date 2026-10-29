from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.scoping import scoped, load_student
from app.schemas import TrialSchema
from app.action_logger import log_action
import uuid

router = APIRouter(prefix="/api/trials", tags=["trials"])


def _to_schema(t: models.Trial) -> TrialSchema:
    return TrialSchema(
        id=t.id,
        date=t.date,
        time=t.time or "",
        durationMinutes=t.duration_minutes,
        notify15Min=bool(t.notify_15min),
        compTimeOvertime=bool(t.comp_time_overtime),
        studentName=t.student_name or "",
        grade=t.grade or "",
        intendedMajor=t.intended_major or "",
        targetUniversity=t.target_university or "",
        areasOfInterest=t.areas_of_interest or "",
        englishLevel=t.english_level or "",
        trialTopic=t.trial_topic or "",
        topicFeasibility=t.topic_feasibility,
        studentMotivation=t.student_motivation,
        epqInterest=t.epq_interest,
        epqSuitability=t.epq_suitability,
        enrollmentIntention=t.enrollment_intention or "",
        feedbackForStudent=t.feedback_for_student or "",
        feedbackForConsultant=t.feedback_for_consultant or "",
        retrospective=t.retrospective or "",
        outcome=t.outcome or "pending",
        linkedStudentId=t.linked_student_id,
        createdAt=t.created_at.isoformat() if t.created_at else "",
        updatedAt=t.updated_at.isoformat() if t.updated_at else "",
    )


@router.get("", response_model=list[TrialSchema])
def list_trials(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    return [_to_schema(t) for t in scoped(db, models.Trial, tutor).order_by(models.Trial.date.desc()).all()]


def _checked_link(db, tutor, student_id):
    """试听关联的学生必须属于同一租户 —— 否则可用别人的学生 id 建立关联。"""
    if not student_id:
        return None
    load_student(db, student_id, tutor)   # 不属于本租户则 404
    return student_id


@router.post("", response_model=TrialSchema)
def create_trial(
    data: TrialSchema,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    trial = models.Trial(
        tutor_id=tutor.id,
        id=data.id or str(uuid.uuid4()),
        date=data.date,
        time=data.time or None,
        duration_minutes=data.durationMinutes,
        notify_15min=bool(data.notify15Min),
        comp_time_overtime=bool(data.compTimeOvertime),
        student_name=data.studentName,
        grade=data.grade,
        intended_major=data.intendedMajor,
        target_university=data.targetUniversity,
        areas_of_interest=data.areasOfInterest,
        english_level=data.englishLevel,
        trial_topic=data.trialTopic,
        topic_feasibility=data.topicFeasibility,
        student_motivation=data.studentMotivation,
        epq_interest=data.epqInterest,
        epq_suitability=data.epqSuitability,
        enrollment_intention=data.enrollmentIntention,
        feedback_for_student=data.feedbackForStudent,
        feedback_for_consultant=data.feedbackForConsultant,
        retrospective=data.retrospective,
        outcome=data.outcome,
        linked_student_id=_checked_link(db, tutor, data.linkedStudentId),
    )
    db.add(trial)
    log_action(db, tutor, "create", "trial", trial.id, {"studentName": data.studentName})
    db.commit()
    db.refresh(trial)
    return _to_schema(trial)


@router.put("/{trial_id}", response_model=TrialSchema)
def update_trial(
    trial_id: str,
    data: TrialSchema,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    trial = scoped(db, models.Trial, tutor).filter(models.Trial.id == trial_id).first()
    if trial is None:
        raise HTTPException(status_code=404, detail="Trial not found")
    trial.date = data.date
    trial.time = data.time or None
    trial.duration_minutes = data.durationMinutes
    trial.notify_15min = bool(data.notify15Min)
    trial.comp_time_overtime = bool(data.compTimeOvertime)
    trial.student_name = data.studentName
    trial.grade = data.grade
    trial.intended_major = data.intendedMajor
    trial.target_university = data.targetUniversity
    trial.areas_of_interest = data.areasOfInterest
    trial.english_level = data.englishLevel
    trial.trial_topic = data.trialTopic
    trial.topic_feasibility = data.topicFeasibility
    trial.student_motivation = data.studentMotivation
    trial.epq_interest = data.epqInterest
    trial.epq_suitability = data.epqSuitability
    trial.enrollment_intention = data.enrollmentIntention
    trial.feedback_for_student = data.feedbackForStudent
    trial.feedback_for_consultant = data.feedbackForConsultant
    trial.retrospective = data.retrospective
    trial.outcome = data.outcome
    trial.linked_student_id = _checked_link(db, tutor, data.linkedStudentId)
    log_action(db, tutor, "update", "trial", trial.id, {"outcome": data.outcome})
    db.commit()
    db.refresh(trial)
    return _to_schema(trial)


@router.delete("/{trial_id}")
def delete_trial(
    trial_id: str,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    trial = scoped(db, models.Trial, tutor).filter(models.Trial.id == trial_id).first()
    if trial is None:
        raise HTTPException(status_code=404, detail="Trial not found")
    db.delete(trial)
    log_action(db, tutor, "delete", "trial", trial_id)
    db.commit()
    return {"ok": True}
