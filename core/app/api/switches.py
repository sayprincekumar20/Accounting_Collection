"""Per-wave switches: the way a piece is moved to the backend, or moved back to n8n, in one call."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit
from app.db import get_session
from app.models import FeatureSwitch
from app.security import acting_user, require_service

router = APIRouter(prefix="/v1", tags=["switches"], dependencies=[Depends(require_service)])


class SwitchChange(BaseModel):
    mode: Literal["n8n", "shadow", "core"]
    note: str = Field(default="", max_length=500)


def _dump(s: FeatureSwitch) -> dict[str, str]:
    return {
        "key": s.key,
        "mode": s.mode,
        "note": s.note,
        "updated_at": s.updated_at.isoformat(),
        "updated_by": s.updated_by,
    }


@router.get("/switches")
def list_switches(session: Session = Depends(get_session)) -> dict[str, list[dict[str, str]]]:
    rows = session.scalars(select(FeatureSwitch).order_by(FeatureSwitch.key)).all()
    return {"items": [_dump(r) for r in rows]}


@router.put("/switches/{key}")
def change_switch(
    key: str,
    body: SwitchChange,
    actor: str = Depends(acting_user),
    session: Session = Depends(get_session),
) -> dict[str, str]:
    row = session.get(FeatureSwitch, key)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown switch")
    before = row.mode
    row.mode = body.mode
    row.updated_by = actor
    if body.note:
        row.note = body.note
    audit.record(
        session,
        actor=actor,
        action="switch.changed",
        subject_type="switch",
        subject_id=key,
        detail={"from": before, "to": body.mode},
    )
    session.commit()
    session.refresh(row)
    return _dump(row)
