"""Document requests. /v1/requests (API key; dashboard): draft, send, list.
/public/requests/{token} (no key; the secure code is the access): the upload page."""

from collections.abc import Callable

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_enqueuer, require_api_key
from app.api.reviews import _reviewer
from app.config import get_settings
from app.db.models import DocumentRequest
from app.db.session import get_db
from app.review import requests as svc
from app.zoho.errors import ZohoError

router = APIRouter(prefix="/v1/requests", tags=["requests"],
                   dependencies=[Depends(require_api_key)])
public = APIRouter(prefix="/public/requests", tags=["upload page"])


def _guard(fn):
    try:
        return fn()
    except svc.RequestError as exc:
        raise HTTPException(409, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ZohoError as exc:
        raise HTTPException(502, f"Zoho: {str(exc)[:200]}") from exc


class DocumentIn(BaseModel):
    type: str
    label: str | None = None
    reason: str | None = None


class RequestIn(BaseModel):
    account_id: str
    recipient_kind: str = "owner"
    to: str
    cc: str | None = None
    subject: str
    body: str
    documents: list[DocumentIn]
    review_id: str | None = None


@router.get("/draft")
def draft(account_id: str, recipient: str = "owner", documents: str | None = Query(None),
          x_reviewer: str | None = Header(None), db: Session = Depends(get_db)) -> dict:
    only = [d for d in (documents or "").split(",") if d] or None
    s = get_settings()
    return _guard(lambda: svc.draft(db, account_id, recipient, (x_reviewer or "").strip()
                                    or "Accounts team", only, s.request_link_days))


@router.post("")
def send(body: RequestIn, x_reviewer: str | None = Header(None),
         db: Session = Depends(get_db)) -> dict:
    from app.notify.gmail import GmailClient
    who, s = _reviewer(x_reviewer), get_settings()
    req = _guard(lambda: svc.create_and_send(
        db, GmailClient.from_settings(s), s, account_id=body.account_id,
        recipient_kind=body.recipient_kind, to=body.to, cc=body.cc, subject=body.subject,
        body=body.body, documents=[d.model_dump() for d in body.documents], reviewer=who,
        review_id=body.review_id))
    base = (s.dashboard_url or "").rstrip("/")
    return svc.view(req, f"{base}/upload/{req.token}")


@router.get("")
def list_requests(account_id: str | None = None, limit: int = Query(100, le=500),
                  db: Session = Depends(get_db)) -> dict:
    q = select(DocumentRequest).order_by(DocumentRequest.created_at.desc()).limit(limit)
    if account_id:
        q = q.where(DocumentRequest.account_id == account_id)
    return {"items": [svc.view(r) for r in db.scalars(q)]}


@public.get("/{token}")
def page(token: str, db: Session = Depends(get_db)) -> dict:
    return _guard(lambda: svc.public_view(svc.by_token(db, token)))


@public.post("/{token}/files")
async def add_file(token: str, document_type: str = Form(...), file: UploadFile = File(...),
                   db: Session = Depends(get_db)) -> dict:
    from app.zoho.factory import get_zoho_client
    s = get_settings()
    data = await file.read(s.max_file_bytes + 1)
    return _guard(lambda: svc.upload(db, get_zoho_client(), svc.by_token(db, token),
                                     document_type, file.filename or "document", data,
                                     file.content_type or "", s.max_file_bytes))


@public.post("/{token}/submit")
def finish(token: str, enqueue: Callable[[str], None] = Depends(get_enqueuer),
           db: Session = Depends(get_db)) -> dict:
    return _guard(lambda: svc.submit(db, svc.by_token(db, token), enqueue))
