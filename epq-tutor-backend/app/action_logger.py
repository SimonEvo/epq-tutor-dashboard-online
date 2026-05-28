"""Lightweight helper for logging data mutations to the action_logs table.

Caller is responsible for committing the transaction.
"""
from sqlalchemy.orm import Session
from app import models


def log_action(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: str = "",
    metadata: dict | None = None,
) -> None:
    """Record one action-log entry. Does not commit."""
    db.add(models.ActionLog(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id or "",
        action_metadata=metadata or {},
    ))
