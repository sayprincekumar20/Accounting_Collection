"""Document requests: a pre-filled, editable email to the Account Owner (default) or the
customer listing exactly the documents needed, with a secure upload link. Uploaded files are
attached to the Account in Zoho and the account is verified again."""

import re
import secrets
from datetime import UTC, date, datetime, timedelta
from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.assessment.alerts import label
from app.db.models import DocumentRequest, JobAssessment, Review, VerificationJob, utcnow
from app.services.audit import record_event

LINK_PLACEHOLDER = "{{upload_link}}"
ALLOWED = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff",
           ".doc", ".docx"}
MAX_UPLOADS = 30


class RequestError(ValueError):
    """Shown to the dashboard or the upload page as HTTP 409/404/422."""


def _fmt(iso: str | None) -> str:
    return date.fromisoformat(iso).strftime("%d %b %Y") if iso else ""


def latest(db: Session, account_id: str) -> tuple[VerificationJob | None, dict | None]:
    row = db.execute(
        select(VerificationJob, JobAssessment)
        .join(JobAssessment, JobAssessment.job_id == VerificationJob.id)
        .where(VerificationJob.account_id == account_id)
        .order_by(JobAssessment.created_at.desc()).limit(1)).first()
    return (row[0], row[1].assessment) if row else (None, None)


def needed_documents(assessment: dict | None, only: list[str] | None = None) -> list[dict]:
    """Missing, expired and unclear required documents (or the ones asked for)."""
    out = []
    for r in (assessment or {}).get("requirements") or []:
        t, st = r["document_type"], r["status"]
        if only and t not in only:
            continue
        reason = {"MISSING": "missing", "EXPIRED": f"expired on {_fmt(r.get('valid_until'))}",
                  "UNKNOWN": "expiry date could not be read"}.get(st)
        if reason is None and only:
            until = r.get("valid_until")
            reason = f"renewal (valid until {_fmt(until)})" if until else "requested"
        if reason:
            out.append({"type": t, "label": label(t), "reason": reason})
    return out


def _recipients(job: VerificationJob | None) -> dict:
    snap = (job.account_snapshot if job else None) or {}
    owner = snap.get("Owner") if isinstance(snap.get("Owner"), dict) else {}
    customer = None
    for c in snap.get("_contacts") or []:
        roles = " ".join(str(v) for v in (c.get("roles") or {}).values()).upper()
        if c.get("email") and (c.get("primary") or "ACCOUNTING" in roles or "ACCOUTING" in roles):
            customer = {"name": c.get("name"), "email": c.get("email")}
            break
    return {"owner": {"name": owner.get("name"), "email": owner.get("email")},
            "customer": customer}


def _first(name: str | None) -> str:
    return (name or "").strip().split(" ")[0].title() or "there"


def template(kind: str, account: str, number: str | None, docs: list[dict], to_name: str | None,
             reviewer: str, until: date) -> tuple[str, str]:
    who = f"{account} ({number})" if number else account
    items = "\n".join(f"- {d['label']} ({d['reason']})" for d in docs) or "- (no documents listed)"
    if kind == "customer":
        subject = f"Documents needed for your account: {account}"
        body = (f"Dear {to_name or 'Customer'},\n\n"
                "Thank you for doing business with Rare Global Food. To complete your account "
                "requirements, please send us the following documents:\n\n"
                f"{items}\n\n"
                "You can upload them securely here (PDF or clear photos):\n"
                f"{LINK_PLACEHOLDER}\n\n"
                f"The link is valid until {until.strftime('%d %b %Y')}. If you have questions, "
                "please reply to this email.\n\n"
                f"Thank you,\n{reviewer}\nRare Global Food - Accounts Team")
    else:
        subject = f"Documents needed: {account}"
        body = (f"Hello {_first(to_name)},\n\n"
                f"To complete the verification of {who}, we need the following documents from "
                "the customer:\n\n"
                f"{items}\n\n"
                "Please collect them and upload them here (PDF or clear photos):\n"
                f"{LINK_PLACEHOLDER}\n\n"
                "You can also attach them to the Account in Zoho CRM and click Verify Account. "
                f"The link is valid until {until.strftime('%d %b %Y')}.\n\n"
                f"Thank you,\n{reviewer}\nRare Global Food - Accounts Team")
    return subject, body


def draft(db: Session, account_id: str, kind: str, reviewer: str,
          only: list[str] | None = None, request_days: int = 14) -> dict:
    job, assessment = latest(db, account_id)
    if job is None:
        raise RequestError("This account has not been verified yet")
    rec = _recipients(job)
    kind = "customer" if kind == "customer" and rec["customer"] else "owner"
    to = rec["customer"] if kind == "customer" else rec["owner"]
    docs = needed_documents(assessment, only)
    snap = job.account_snapshot or {}
    account = snap.get("Account_Name") or account_id
    number = snap.get("Inventory_Customer_Number") or job.customer_number
    until = (datetime.now(UTC) + timedelta(days=request_days)).date()
    subject, body = template(kind, account, number, docs, to.get("name"), reviewer, until)
    cc = [e for e in [rec["owner"].get("email") if kind == "customer" else None] if e]
    return {"account_id": account_id, "account_name": account, "customer_number": number,
            "recipient_kind": kind, "recipients": rec, "to": to.get("email") or "",
            "cc": ", ".join(cc), "subject": subject, "body": body, "documents": docs,
            "placeholder": LINK_PLACEHOLDER}


def _html(text: str) -> str:
    out = escape(text)
    out = re.sub(r"(https?://\S+)", r'<a href="\1">\1</a>', out)
    return ('<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;'
            'color:#101828;max-width:640px;white-space:pre-wrap">' + out + "</div>")


def _emails(value: str | None) -> list[str]:
    from app.notify.emails import valid
    return valid(re.split(r"[,;\s]+", value or ""))


def create_and_send(db: Session, mailer, settings, *, account_id: str, recipient_kind: str,
                    to: str, cc: str | None, subject: str, body: str, documents: list[dict],
                    reviewer: str, review_id: str | None = None) -> DocumentRequest:
    recipients = _emails(to)
    if not recipients:
        raise RequestError("Enter a valid recipient email")
    if not documents:
        raise RequestError("Choose at least one document to request")
    if mailer is None:
        raise RequestError("Email is not configured on the engine (GMAIL_ settings)")
    import uuid
    try:
        review_uuid = uuid.UUID(str(review_id)) if review_id else None
    except ValueError:
        review_uuid = None
    job, _ = latest(db, account_id)
    snap = (job.account_snapshot if job else None) or {}
    req = DocumentRequest(
        token=secrets.token_urlsafe(32), account_id=account_id,
        account_name=snap.get("Account_Name") or account_id,
        customer_number=(snap.get("Inventory_Customer_Number")
                         or (job.customer_number if job else None)),
        review_id=review_uuid, recipient_kind=recipient_kind, recipient_email=", ".join(recipients),
        cc=", ".join(_emails(cc)) or None, subject=subject.strip()[:255], body=body,
        documents=[{"type": d["type"], "label": d.get("label") or label(d["type"]),
                    "reason": d.get("reason") or "requested"} for d in documents],
        uploads=[], status="Requested", requested_by=reviewer,
        expires_at=utcnow() + timedelta(days=int(getattr(settings, "request_link_days", 14))))
    base = (getattr(settings, "dashboard_url", "") or "").rstrip("/")
    link = f"{base}/upload/{req.token}"
    text = body.replace(LINK_PLACEHOLDER, link) if LINK_PLACEHOLDER in body else \
        f"{body.rstrip()}\n\nUpload link: {link}"
    if not mailer.send(recipients, _emails(cc), req.subject, text, _html(text)):
        raise RequestError("The email could not be sent (see the engine log)")
    req.body = text
    db.add(req)
    db.flush()
    record_event(db, "DOCUMENTS_REQUESTED",
                 f"{', '.join(d['label'] for d in req.documents)} from {req.recipient_email}",
                 job.id if job else None, {"request_id": str(req.id), "by": reviewer})
    if review_uuid:   # the review this came from waits for the documents
        from app.review import engine
        review = db.get(Review, review_uuid)
        if review is not None and review.status in engine.OPEN:
            engine.close_without_writing(
                db, review, reviewer, "Waiting for Documents",
                f"Documents requested from {req.recipient_email}: "
                + ", ".join(d["label"] for d in req.documents))
    db.commit()
    return req


def view(req: DocumentRequest, include_link: str | None = None) -> dict:
    received = {u["type"] for u in req.uploads or []}
    return {"id": str(req.id), "account_id": req.account_id, "account_name": req.account_name,
            "customer_number": req.customer_number, "status": req.status,
            "recipient_kind": req.recipient_kind, "recipient_email": req.recipient_email,
            "requested_by": req.requested_by,
            "documents": [{**d, "received": d["type"] in received} for d in req.documents],
            "uploads": [{k: u.get(k) for k in ("type", "file", "at")} for u in req.uploads or []],
            "created_at": req.created_at.isoformat() if req.created_at else None,
            "expires_at": req.expires_at.isoformat() if req.expires_at else None,
            "link": include_link}


# ---------------------------------------------------------------- the public upload page
def by_token(db: Session, token: str) -> DocumentRequest:
    req = db.scalar(select(DocumentRequest).where(DocumentRequest.token == token)) \
        if token and len(token) >= 30 else None
    if req is None:
        raise LookupError("This link is not valid")
    expires = req.expires_at if req.expires_at.tzinfo else req.expires_at.replace(tzinfo=UTC)
    if datetime.now(UTC) > expires and req.status != "Submitted":
        req.status = "Expired"
        db.commit()
    return req


def public_view(req: DocumentRequest) -> dict:
    """What the person with the link sees: the company name and its checklist, nothing else."""
    v = view(req)
    return {"account_name": v["account_name"], "status": v["status"],
            "documents": v["documents"], "expires_at": v["expires_at"],
            "open": req.status in ("Requested", "Partly received")}


def upload(db: Session, client, req: DocumentRequest, doc_type: str, file_name: str,
           data: bytes, content_type: str, max_bytes: int) -> dict:
    import os
    if req.status not in ("Requested", "Partly received"):
        raise RequestError("This request is closed" if req.status != "Expired"
                           else "This link has expired; ask Rare Global Food for a new one")
    wanted = {d["type"]: d["label"] for d in req.documents}
    if doc_type not in wanted:
        raise RequestError("Unknown document")
    ext = os.path.splitext(file_name or "")[1].lower()
    if ext not in ALLOWED:
        raise RequestError("Please upload a PDF, a photo (JPG, PNG, HEIC) or a Word file")
    if not data or len(data) > max_bytes:
        raise RequestError(f"The file is empty or larger than {max_bytes // (1024 * 1024)} MB")
    if len(req.uploads or []) >= MAX_UPLOADS:
        raise RequestError("Too many files for this request")
    safe = re.sub(r"[^\w.\- ()]+", "_", os.path.basename(file_name))[:120]
    name = f"{wanted[doc_type]} - {safe}"[:200]
    zoho_id = client.upload_attachment("Accounts", req.account_id, name, data,
                                       content_type or "application/octet-stream")
    req.uploads = [*(req.uploads or []), {"type": doc_type, "file": name, "zoho_id": zoho_id,
                                          "at": utcnow().isoformat()}]
    received = {u["type"] for u in req.uploads}
    req.status = "Partly received" if received < set(wanted) else req.status
    db.commit()
    return {"received": sorted(received), "complete": received >= set(wanted)}


def submit(db: Session, req: DocumentRequest, enqueue) -> dict:
    """All files uploaded: verify the account again (one job; a running one is reused)."""
    from app.schemas import JobCreate
    from app.services.jobs import create_or_get_active_job
    if not req.uploads:
        raise RequestError("Upload at least one document first")
    if req.status == "Submitted":
        return {"status": "Submitted"}
    job, created = create_or_get_active_job(db, JobCreate(
        account_id=req.account_id, customer_number=req.customer_number or None,
        reason="Documents uploaded through the request link", document_status="YES",
        source="api"))
    if created:
        enqueue(str(job.id))
    req.status, req.job_id, req.submitted_at = "Submitted", job.id, utcnow()
    record_event(db, "REQUEST_DOCUMENTS_SUBMITTED", f"{len(req.uploads)} file(s) uploaded",
                 job.id, {"request_id": str(req.id)})
    db.commit()
    return {"status": "Submitted"}
