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
    kind: str | None = None


class RequestIn(BaseModel):
    account_id: str
    recipient_kind: str = "owner"
    to: str
    cc: str | None = None
    subject: str
    body: str
    documents: list[DocumentIn]
    review_id: str | None = None
    link_days: int | None = None


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
        review_id=body.review_id, days=body.link_days))
    base = (s.dashboard_url or "").rstrip("/")
    return svc.view(req, f"{base}/upload/{req.token}")


@router.get("")
def list_requests(account_id: str | None = None, limit: int = Query(100, le=500),
                  db: Session = Depends(get_db)) -> dict:
    q = select(DocumentRequest).order_by(DocumentRequest.created_at.desc()).limit(limit)
    if account_id:
        q = q.where(DocumentRequest.account_id == account_id)
    base = (get_settings().dashboard_url or "").rstrip("/")
    return {"items": [svc.view(r, f"{base}/upload/{r.token}"
                               if r.status in ("Requested", "Partly received") else None)
                      for r in db.scalars(q)]}


@router.post("/{request_id}/resend")
def resend(request_id: str, x_reviewer: str | None = Header(None),
           db: Session = Depends(get_db)) -> dict:
    import uuid

    from app.notify.gmail import GmailClient
    _reviewer(x_reviewer)
    try:
        req = db.get(DocumentRequest, uuid.UUID(request_id))
    except ValueError:
        req = None
    if req is None:
        raise HTTPException(404, "Unknown request")
    _guard(lambda: svc.resend(db, GmailClient.from_settings(get_settings()), req))
    return svc.view(req)


@public.get("/{token}")
def page(token: str, db: Session = Depends(get_db)) -> dict:
    return _guard(lambda: svc.public_view(svc.by_token(db, token)))


@public.post("/{token}/files")
async def add_file(token: str, document_type: str = Form(...), file: UploadFile = File(...),
                   enqueue: Callable[[str], None] = Depends(get_enqueuer),
                   db: Session = Depends(get_db)) -> dict:
    from app.zoho.factory import get_zoho_client
    s = get_settings()
    data = await file.read(s.max_file_bytes + 1)

    def go():
        req = svc.by_token(db, token)
        result = svc.upload(db, get_zoho_client(), req, document_type,
                            file.filename or "document", data, file.content_type or "",
                            s.max_file_bytes)
        if result["complete"]:        # every requested document is in: check right away
            svc.submit(db, req, enqueue)
            result["submitted"] = True
        return result
    return _guard(go)


@public.post("/{token}/submit")
def finish(token: str, enqueue: Callable[[str], None] = Depends(get_enqueuer),
           db: Session = Depends(get_db)) -> dict:
    return _guard(lambda: svc.submit(db, svc.by_token(db, token), enqueue))
