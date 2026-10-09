"""Resit（二次提交）：把当前这次提交存成快照，学生在新一轮从头开始。

和延期的区别（见 ADR 0007）：
  - 延期 = 这次提交挪到下一轮，原轮次的 ddl 安排作废，不留痕迹。
  - resit = 这次提交**已经发生**，留档成只读快照；新一轮是另一次提交，
    有自己的 ddl、检查清单、Tii 记录、里程碑和 SA 额度。

快照存在 students.previous_attempts（列表，按 attempt 升序）。当前是第几次
提交不单独存，由列表长度推出 —— 少一个会跟列表对不上的字段。

报名轮次和一年期标记不动：resit 不改变学生最初签的是哪一批。
"""
from datetime import datetime, timezone

from app import models, rounds, submission


def current_attempt(student: models.Student) -> int:
    return len(student.previous_attempts or []) + 1


def previous_rounds(student: models.Student) -> list[str]:
    """之前各次提交所在的轮次 —— 学生在这些轮次里也要显示（「已提交 · resit」）。

    按 attempt 顺序一一对应（第 i 项 = 第 i+1 次提交），没填轮次的占位为空串，
    前端靠下标反推「这个轮次是第几次提交」。
    """
    return [a.get("submissionRound") or "" for a in (student.previous_attempts or [])]


def sa_hours_used(student: models.Student, sessions) -> int:
    """当前这次提交已排的 SA 课次（不含最终答辩），与前端 countsAsSaHour 同口径。"""
    attempt = current_attempt(student)
    return sum(
        1 for x in sessions
        if x.type == "SA_MEETING" and not x.is_final_defense and (x.attempt or 1) == attempt
    )


def _snapshot(student: models.Student) -> dict:
    return {
        "attempt": current_attempt(student),
        "submissionRound": student.submission_round,
        "deadlineTier": student.deadline_tier or "normal",
        "deadlineOverride": student.deadline_override,
        "deadlineChangeConfirmed": bool(student.deadline_change_confirmed),
        "submissionChecklist": submission.normalize_checklist(student.submission_checklist),
        "tiiChecks": list(student.tii_checks or []),
        "wrappedUpAt": student.wrapped_up_at.isoformat() if student.wrapped_up_at else None,
        "defenseConfirmed": bool(student.defense_confirmed),
        "milestones": {m.milestone_id: m.status for m in student.milestones},
        "saHoursTotal": student.sa_hours_total,
        # 现算，不信库里存的值 —— 它由前端回写，旧数据未必准
        "saHoursUsed": sa_hours_used(student, student.sessions),
        "closedAt": datetime.now(timezone.utc).isoformat(),
    }


def start(db, student: models.Student, round_label: str, sa_hours_total: int) -> None:
    """存快照，学生进入下一次提交。调用方负责 commit。"""
    snap = _snapshot(student)
    student.previous_attempts = [*(student.previous_attempts or []), snap]

    student.submission_round = rounds.normalize_round(round_label)
    student.deadline_tier = "normal"
    student.deadline_override = None
    student.deadline_change_confirmed = False
    student.submission_checklist = None
    student.tii_checks = []
    student.wrapped_up_at = None
    student.defense_confirmed = False
    student.sa_hours_total = sa_hours_total
    student.sa_hours_used = 0
    db.query(models.StudentMilestone).filter(
        models.StudentMilestone.student_id == student.id
    ).delete()
    student.updated_at = datetime.now(timezone.utc)


def undo(db, student: models.Student) -> None:
    """撤销最近一次 resit：快照原样恢复，resit 期间排的课并回上一次提交。

    给「点错了」留的退路。resit 期间新记的 Tii / 清单 / 里程碑会被快照覆盖 ——
    调用方在界面上要提示这一点。调用方负责 commit。
    """
    attempts = list(student.previous_attempts or [])
    snap = attempts.pop()
    resit_attempt = snap["attempt"] + 1

    student.previous_attempts = attempts or None
    student.submission_round = snap.get("submissionRound")
    student.deadline_tier = snap.get("deadlineTier") or "normal"
    student.deadline_override = snap.get("deadlineOverride")
    student.deadline_change_confirmed = bool(snap.get("deadlineChangeConfirmed"))
    student.submission_checklist = snap.get("submissionChecklist")
    student.tii_checks = list(snap.get("tiiChecks") or [])
    wrapped = snap.get("wrappedUpAt")
    student.wrapped_up_at = datetime.fromisoformat(wrapped) if wrapped else None
    student.defense_confirmed = bool(snap.get("defenseConfirmed"))
    student.sa_hours_total = snap.get("saHoursTotal", student.sa_hours_total)

    for x in student.sessions:
        if (x.attempt or 1) == resit_attempt:
            x.attempt = snap["attempt"]
    student.sa_hours_used = sa_hours_used(student, student.sessions)

    db.query(models.StudentMilestone).filter(
        models.StudentMilestone.student_id == student.id
    ).delete()
    for mid, status in (snap.get("milestones") or {}).items():
        db.add(models.StudentMilestone(student_id=student.id, milestone_id=mid, status=status))
    student.updated_at = datetime.now(timezone.utc)
