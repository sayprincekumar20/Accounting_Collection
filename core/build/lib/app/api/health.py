from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def ready(session: Session = Depends(get_session)) -> dict[str, str]:
    try:
        session.execute(text("select 1"))
    except Exception as exc:  # the database is the only dependency of this check
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok", "database": "ok"}
