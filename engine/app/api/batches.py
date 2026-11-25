"""Batch check API (API key; actions need X-Reviewer)."""

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_api_key
from app.api.reviews import _reviewer
from app.db.models import BatchItem, BatchRun
from app.db.session import get_db
from app.review import batches as svc
from app.zoho.errors import ZohoError

router = APIRouter(prefix="/v1/batches", tags=["batch check"],
                   dependencies=[Depends(require_api_key)])


def _client():
    from app.zoho.factory import get_zoho_client
    return get_zoho_client()


def _guard(fn):
    try:
        return fn()
    except svc.BatchError as exc:
        raise HTTPException(409, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ZohoError as exc:
        raise HTTPException(502, f"Zoho: {str(exc)[:200]}") from exc


def _batch(batch_id: uuid.UUID, db: Session) -> BatchRun:
    b = db.get(BatchRun, batch_id)
    if b is None:
        raise HTTPException(404, "Unknown batch")
    return b


class StartIn(BaseModel):
    channel: str
    size: int = 20


class SpotIn(BaseModel):
    verdict: str
    note: str | None = None


@router.get("/channels")
def channel_list() -> dict:
    return {"channels": _guard(lambda: svc.channels(_client()))}


@router.get("/overview")
def channel_overview(channel: str = Query(..., min_length=2),
                     db: Session = Depends(get_db)) -> dict:
    return _guard(lambda: svc.overview(db, _client(), channel))


@router.get("")
def batch_list(db: Session = Depends(get_db)) -> dict:
    return {"items": svc.list_batches(db)}


@router.post("")
def batch_start(body: StartIn, x_reviewer: str | None = Header(None),
                db: Session = Depends(get_db)) -> dict:
    who = _reviewer(x_reviewer)
    b = _guard(lambda: svc.start(db, _client(), body.channel, body.size, who))
    return svc.report(db, b)


@router.get("/{batch_id}")
def batch_report(batch_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    return svc.report(db, _batch(batch_id, db))


@router.post("/{batch_id}/{action}")
def batch_action(batch_id: uuid.UUID, action: str, x_reviewer: str | None = Header(None),
                 db: Session = Depends(get_db)) -> dict:
    _reviewer(x_reviewer)
    b = _batch(batch_id, db)
    if action == "pause":
        _guard(lambda: svc.set_paused(db, b, True))
    elif action == "resume":
        _guard(lambda: svc.set_paused(db, b, False))
    elif action == "complete":
        _guard(lambda: svc.complete(db, b))
    else:
        raise HTTPException(404, "Unknown action")
    return svc.report(db, b)


@router.post("/{batch_id}/items/{item_id}/retry")
def item_retry(batch_id: uuid.UUID, item_id: uuid.UUID, x_reviewer: str | None = Header(None),
               db: Session = Depends(get_db)) -> dict:
    _reviewer(x_reviewer)
    item = db.get(BatchItem, item_id)
    if item is None or item.batch_id != batch_id:
        raise HTTPException(404, "Unknown account in this batch")
    _guard(lambda: svc.retry(db, item))
    return svc.report(db, _batch(batch_id, db))


@router.post("/spot-check/{review_id}")
def spot(review_id: uuid.UUID, body: SpotIn, x_reviewer: str | None = Header(None),
         db: Session = Depends(get_db)) -> dict:
    who = _reviewer(x_reviewer)
    item = _guard(lambda: svc.spot_check(db, review_id, body.verdict, body.note, who))
    return {"spot_check": item.spot_check, "spot_note": item.spot_note, "spot_by": item.spot_by}
