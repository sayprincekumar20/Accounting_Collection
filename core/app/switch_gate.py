"""Every action follows its switch: n8n (not yet moved), shadow (dry run only) or core (the backend does it)."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import FeatureSwitch


def require_core_or_dry_run(session: Session, key: str, dry_run: bool) -> None:
    """A dry run is always allowed (it changes nothing). A real change needs the switch on `core`."""
    if dry_run:
        return
    row = session.get(FeatureSwitch, key)
    if row is None or row.mode != "core":
        current = row.mode if row else "missing"
        raise HTTPException(status_code=409, detail=f"{key} is on '{current}': this still goes through n8n")
