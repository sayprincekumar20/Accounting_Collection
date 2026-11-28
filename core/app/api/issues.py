"""Escalations and issue history. Data only: nothing here sends a message or places a call."""

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.approvals import get_n8n_tables
from app.db import get_session
from app.models import IssueEvent
from app.n8n_mirror import N8nTables
from app.security import acting_user, require_service
from app.services.approvals import MirrorError
from app.services.issues import record_event, update_status
from app.switch_gate import require_core_or_dry_run

router = APIRouter(prefix="/v1", tags=["escalations"], dependencies=[Depends(require_service)])
SWITCH = "wave1.escalations"


def _upper(value: Any) -> Any:
    return value.upper() if isinstance(value, str) else value


class StatusChange(BaseModel):
    entry_id: str = Field(min_length=1, max_length=300)
    status: Literal["OPEN", "IN_PROGRESS", "DONE"]
    note: str = Field(default="", max_length=2000)
    dry_run: bool = False

    _status_upper = field_validator("status", mode="before")(_upper)


class IssueEventIn(BaseModel):
    issue_id: str = Field(min_length=1, max_length=300)
    issue_kind: Literal["ESCALATION", "SYSTEM"]
    ref: str = Field(default="", max_length=200)
    event: Literal["DIAGNOSIS", "ACTION", "STATUS", "RESOLUTION", "NOTE"]
    summary: str = Field(min_length=1, max_length=5000)
    detail: Any = ""
    actor: str = Field(default="", max_length=200)
    dry_run: bool = False

    _kind_upper = field_validator("issue_kind", "event", mode="before")(_upper)

    @field_validator("summary")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("summary is required")
        return value


@router.post("/escalations/status")
def change_status(
    body: StatusChange,
    actor: str = Depends(acting_user),
    session: Session = Depends(get_session),
    n8n: N8nTables = Depends(get_n8n_tables),
) -> dict[str, Any]:
    require_core_or_dry_run(session, SWITCH, body.dry_run)
    try:
        return update_status(
            session,
            n8n,
            entry_id=body.entry_id,
            status=body.status,
            note=body.note,
            actor=actor,
            dry_run=body.dry_run,
        )
    except Exception as exc:  # n8n's table is the system of record for the row: nothing was changed
        raise HTTPException(
            status_code=502,
            detail={"message": f"could not update the escalation: {exc}", "saved_in_backend": False},
        ) from exc


@router.post("/issues/events")
def add_event(
    body: IssueEventIn,
    actor: str = Depends(acting_user),
    session: Session = Depends(get_session),
    n8n: N8nTables = Depends(get_n8n_tables),
) -> dict[str, Any]:
    require_core_or_dry_run(session, SWITCH, body.dry_run)
    try:
        return record_event(
            session, n8n, issue_id=body.issue_id, issue_kind=body.issue_kind, ref=body.ref, event=body.event,
            summary=body.summary, detail=body.detail, event_actor=body.actor, acting_user=actor, dry_run=body.dry_run,
        )  # fmt: skip
    except MirrorError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc), "saved_in_backend": True}) from exc


@router.get("/issues/history")
def history(
    issue_id: str = Query(min_length=1, max_length=300), session: Session = Depends(get_session)
) -> dict[str, list[dict[str, Any]]]:
    rows = session.scalars(
        select(IssueEvent).where(IssueEvent.issue_id == issue_id).order_by(IssueEvent.at, IssueEvent.id)
    ).all()
    return {
        "items": [
            {"event": r.event, "summary": r.summary, "actor": r.actor, "at": r.at.isoformat()} for r in rows
        ]
    }
