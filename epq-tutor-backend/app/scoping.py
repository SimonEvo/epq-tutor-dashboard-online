"""租户作用域收口。

背景：本系统原先是单人自用，多数表没有 tutor_id，router 里直接 `db.query(models.X)`
就是全库。开放内测后这等于所有人共用一份数据。P1 给九张表补了 tutor_id，
但"补了列"和"查询真的带上了过滤"是两回事 —— 漏改一个 router 就是一个泄漏点。

所以租户过滤统一走这里，router 里**不应再出现裸 `db.query(models.X)`**
（rounds 和 tutors 例外，见下）。tests/test_tenant_isolation.py 会遍历全部端点
验证这一点。

为什么不用 SQLAlchemy 的全局查询过滤器：隐式、难调试，且遇到 join、原生 SQL
和 relationship 加载就会绕过去，出问题时很难察觉。显式过滤啰嗦但看得见。
见 docs/adr/0004-multi-tenant-internal-beta.md 决策 6。
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Query, Session

from app import models
from app.auth import get_current_tutor

# 不做租户隔离的表，以及原因。
#   tutors  —— 租户表本身
#   rounds  —— 提交轮次是全机构统一的学期批次，全局共享、仅 admin 可写（ADR 决策 3）
GLOBAL_MODELS = {models.Tutor, models.Round}

# 经 student_id 间接归属于租户的表。这些不直接按 tutor_id 过滤，
# 而是先用 load_student() 确认学生属于本租户，再取其关联数据。
STUDENT_OWNED_MODELS = {
    models.Session,
    models.StudentMilestone,
    models.StudentTag,
    models.PersonalEntry,
    models.MindMap,
    models.HomeworkEntry,
    models.StudentLivingSummary,
    models.StudentKnowledgeEntry,
}


def scoped(db: Session, model, tutor: models.Tutor) -> Query:
    """返回已按 tutor 过滤的 query。

    对没有 tutor_id 的模型直接抛错，而不是悄悄返回全表 —— 新加表时如果忘了
    加 tutor_id，会在第一次调用时就炸出来，而不是上线后才发现数据串了。
    """
    if model in GLOBAL_MODELS:
        raise ValueError(f"{model.__name__} 是全局表，不要用 scoped()")
    if not hasattr(model, "tutor_id"):
        raise ValueError(
            f"{model.__name__} 没有 tutor_id。"
            f"若它经 student_id 归属租户，请改用 load_student() 后取关联数据。"
        )
    return db.query(model).filter(model.tutor_id == tutor.id)


def owned(db: Session, model, obj_id: str, tutor: models.Tutor, *, label: str = "记录"):
    """按主键取一条本租户的记录，取不到就 404。

    对跨租户访问故意回 404 而不是 403 —— 403 会泄漏"这个 id 存在"这一事实。
    """
    row = scoped(db, model, tutor).filter(model.id == obj_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label}不存在")
    return row


def load_student(db: Session, student_id: str, tutor: models.Tutor) -> models.Student:
    """确认学生属于本租户。所有 student_id 入参的端点都应先过这一关。"""
    return owned(db, models.Student, student_id, tutor, label="学生")


def require_admin(tutor: models.Tutor = Depends(get_current_tutor)) -> models.Tutor:
    """仅管理员。

    admin 是 tutor 的超集：自己也带学生，额外拥有账号管理和全局配置（rounds）的写权限。
    但 admin **不能读别人的业务数据** —— 那是硬约束，见 ADR 决策 5。
    """
    if tutor.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return tutor
