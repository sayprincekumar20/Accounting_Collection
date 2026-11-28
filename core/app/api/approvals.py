from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session
from app.models import FeatureSwitch
from app.n8n_mirror import N8nHooks, N8nTables, hooks_from_settings, tables_from_settings
from app.security import acting_user, require_service
from app.services.approvals import MirrorError, apply_approvals

router = APIRouter(prefix="/v1", tags=["approvals"], dependencies=[Depends(require_service)])
SWITCH = "wave1.dashboard_actions"


class ApprovalItem(BaseModel):
    client_id: str = Field(min_length=1, max_length=250)
    client_name: str = Field(default="", max_length=400)
    approved: bool = False
    note: str = Field(default="", max_length=2000)
    allow_multibranch: bool = False
    # Invoice numbers unticked at approval: only the ticked ones are sent this cycle. None = no selection sent.
    excluded_invoices: list[Annotated[str, Field(max_length=80)]] | None = Field(default=None, max_length=500)


class ApprovalRequest(BaseModel):
    items: list[ApprovalItem] = Field(min_length=1, max_length=500)
    source: str = Field(default="dashboard", max_length=40)
    # Shadow mode: work out and record what would happen, change nothing.
    dry_run: bool = False


def get_n8n_tables(settings: Settings = Depends(get_settings)) -> N8nTables:
    return tables_from_settings(settings)


def get_n8n_hooks(settings: Settings = Depends(get_settings)) -> N8nHooks:
    return hooks_from_settings(settings)


@router.post("/approvals")
def post_approvals(
    body: ApprovalRequest,
    actor: str = Depends(acting_user),
    session: Session = Depends(get_session),
    n8n: N8nTables = Depends(get_n8n_tables),
    hooks: N8nHooks = Depends(get_n8n_hooks),
) -> dict[str, Any]:
    mode = session.get(FeatureSwitch, SWITCH)
    if not body.dry_run and (mode is None or mode.mode != "core"):
        current = mode.mode if mode else "missing"
        raise HTTPException(
            status_code=409, detail=f"{SWITCH} is on '{current}': approvals still go through n8n"
        )
    items: list[dict[str, Any]] = [i.model_dump() for i in body.items]
    try:
        return apply_approvals(
            session, n8n, hooks, items, actor=actor, source=body.source, dry_run=body.dry_run
        )
    except MirrorError as exc:
        raise HTTPException(
            status_code=502,
            detail={"message": str(exc), "saved_in_backend": True, "batch_id": exc.summary["batch_id"]},
        ) from exc
