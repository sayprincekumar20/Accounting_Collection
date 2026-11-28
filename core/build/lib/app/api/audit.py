from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import AuditLog
from app.security import require_service

router = APIRouter(prefix="/v1", tags=["audit"], dependencies=[Depends(require_service)])


@router.get("/audit")
def list_audit(
    limit: int = Query(50, ge=1, le=500),
    action: str | None = None,
    session: Session = Depends(get_session),
) -> dict[str, list[dict]]:
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    rows = session.scalars(stmt).all()
    return {
        "items": [
            {
                "id": r.id,
                "at": r.at.isoformat(),
                "actor": r.actor,
                "action": r.action,
                "subject_type": r.subject_type,
                "subject_id": r.subject_id,
                "detail": r.detail,
            }
            for r in rows
        ]
    }
