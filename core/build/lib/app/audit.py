from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def record(
    session: Session,
    *,
    actor: str,
    action: str,
    subject_type: str | None = None,
    subject_id: str | None = None,
    detail: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> AuditLog:
    """Add one audit line to the open transaction (the caller commits together with the change itself)."""
    row = AuditLog(
        actor=actor,
        action=action,
        subject_type=subject_type,
        subject_id=subject_id,
        detail=detail or {},
        request_id=request_id,
    )
    session.add(row)
    return row
