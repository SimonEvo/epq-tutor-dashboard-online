"""提交前检查清单 / 提交截止时间 的共享逻辑。

设计见 docs/projects/submission-checklist.md 与 docs/adr/0003。
"""
from sqlalchemy.orm import Session

from app import models

# 首次读取模板为空时落库的种子（任务书 §4）
SEED_TEMPLATE: list[dict] = [
    {"id": "forms_checked", "label": "表格检查完成", "order": 0, "archived": False},
    {"id": "tii_report", "label": "论文检测报告", "order": 1, "archived": False},
    {"id": "defense_recording", "label": "答辩录屏+转录", "order": 2, "archived": False},
]

TII_LIMIT = 3  # 第 3 次起标红警示（不阻断）


def get_template(db: Session, tutor: models.Tutor) -> list[dict]:
    """读模板；为空则写入种子并落库。"""
    if not tutor.submission_checklist_template:
        tutor.submission_checklist_template = [dict(x) for x in SEED_TEMPLATE]
        db.commit()
    items = tutor.submission_checklist_template or []
    return sorted(
        [{"id": i["id"], "label": i.get("label", ""), "order": i.get("order", 0),
          "archived": bool(i.get("archived", False))} for i in items],
        key=lambda i: i["order"],
    )


def round_deadlines(db: Session) -> dict[str, dict]:
    """round 名 → {normal, extended}。"""
    return {
        r.name: {"normal": r.deadline_normal, "extended": r.deadline_extended}
        for r in db.query(models.Round).all()
    }


def effective_deadline(student: models.Student, deadlines: dict[str, dict]) -> str | None:
    """有效 ddl = deadlineOverride ?? round[deadlineTier]；都为空 → None（前端显示「待定」）。"""
    if student.deadline_override:
        return student.deadline_override
    r = deadlines.get(student.submission_round or "")
    if not r:
        return None
    return r.get("extended" if (student.deadline_tier or "normal") == "extended" else "normal")


def needs_confirm(student: models.Student) -> bool:
    """任何偏离本届 normal ddl 的安排都需要运营组确认。"""
    return (student.deadline_tier or "normal") == "extended" or student.deadline_override is not None


def deadline_needs_confirm_warning(student: models.Student) -> bool:
    """需要确认但尚未确认 → 前端 ⚠。"""
    return needs_confirm(student) and not bool(student.deadline_change_confirmed)


# 表13证据：每个学生都有的两条固定项，不可删；其余由导师自由添加
T13_FIXED: list[dict] = [
    {"id": "t13_paper", "label": "论文/报告"},
    {"id": "t13_ppt", "label": "PPT的PDF"},
]
T13_FIXED_IDS = {i["id"] for i in T13_FIXED}


def ensure_fixed_items(items: list) -> list:
    """把两条固定项补齐并置顶，保留已有的完成状态。

    在读和写两条路径上都跑一遍 —— 老学生无需迁移，删固定项的请求也自动被撤销。
    """
    by_id = {i.get("id"): i for i in items if isinstance(i, dict)}
    fixed = [
        {
            **fx,
            "done": bool(by_id.get(fx["id"], {}).get("done", False)),
            "doneAt": by_id.get(fx["id"], {}).get("doneAt"),
            "fixed": True,
        }
        for fx in T13_FIXED
    ]
    rest = [
        {**i, "fixed": False}
        for i in items
        if isinstance(i, dict) and i.get("id") not in T13_FIXED_IDS
    ]
    return fixed + rest


def normalize_checklist(raw) -> dict:
    """学生 submission_checklist 列的规范形态。"""
    raw = raw or {}
    return {
        "ticked": dict(raw.get("ticked") or {}),
        "customItems": ensure_fixed_items(list(raw.get("customItems") or [])),
    }
