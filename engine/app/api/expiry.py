"""GET /v1/expiry: document expiry overview for the dashboard's Document Expiry view."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import require_api_key
from app.db.session import get_db
from app.notify.notifier import MANILA
from app.review.expiry import STATES, expiry_overview

router = APIRouter(prefix="/v1/expiry", tags=["expiry"], dependencies=[Depends(require_api_key)])


@router.get("")
def list_expiry(state: str | None = Query(None, description=" | ".join(STATES)),
                account_id: str | None = None, db: Session = Depends(get_db)) -> dict:
    from datetime import datetime
    today = datetime.now(MANILA).date()
    items = expiry_overview(db, today)
    counts = {s: sum(1 for i in items if i["state"] == s) for s in STATES}
    if state:
        items = [i for i in items if i["state"] == state]
    if account_id:
        items = [i for i in items if i["account_id"] == account_id]
    return {"today": today.isoformat(), "counts": counts, "items": items}
