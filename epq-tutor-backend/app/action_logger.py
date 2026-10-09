"""Lightweight helper for logging data mutations to the action_logs table.

Caller is responsible for committing the transaction.
"""
from sqlalchemy.orm import Session
from app import models


def log_action(
    db: Session,
    tutor: models.Tutor,
    action: str,
    entity_type: str,
    entity_id: str = "",
    metadata: dict | None = None,
) -> None:
    """Record one action-log entry for this tutor. Does not commit.

    tutor 是必填位置参数（P1 多租户）：action_logs 原先是全局表，
    不带 tutor 的旧式调用会在 `tutor.id` 上炸掉，而不是悄悄写成别人的日志。
    """
    db.add(models.ActionLog(
        tutor_id=tutor.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id or "",
        action_metadata=metadata or {},
    ))
