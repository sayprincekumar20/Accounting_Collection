"""Batch check: verify the Active accounts of one channel in batches (default 20), quietly:
no status change, no emails, nothing written to Zoho. Results go to Document expiry (dates),
Reviews (only accounts that need a decision count as open; every account is browsable) and the
batch report (from which documents are requested)."""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.assessment.alerts import build_alerts, label
from app.db.models import (
    BatchItem,
    BatchRun,
    JobAssessment,
    JobStatus,
    Review,
    VerificationJob,
    utcnow,
)
from app.services.audit import record_event

TERMINAL = ("Done", "No documents", "Failed")
CHECK_AGAIN_DAYS = 365      # an account checked more than a year ago counts as "left" again
PARALLEL = 2                # accounts checked at the same time per batch


class BatchError(ValueError):
    pass


# ------------------------------------------------------------------ Zoho
def channels(client) -> list[str]:
    """Values of the Accounts field Channel (picklist)."""
    try:
        for f in client.get_fields("Accounts"):
            if f.get("api_name") == "Channel":
                return [v.get("display_value") or v.get("actual_value")
                        for v in f.get("pick_list_values") or []
                        if (v.get("display_value") or "") not in ("", "-None-")]
    except Exception:  # noqa: BLE001 - fall back to the known channels
        pass
    return ["General Trade - Food Service", "General Trade - Industrial",
            "General Trade - Traders", "General Trade - Wet Market",
            "General Trade - Ecommerce", "Key Accounts - Food Service"]


def _escape(value: str) -> str:
    return "".join(f"\\{c}" if c in "(),\\" else c for c in value)


def active_accounts(client, channel: str) -> list[dict]:
    rows = client.search_records(
        "Accounts", f"((Customer_Status:equals:Active)and(Channel:equals:{_escape(channel)}))")
    return [{"id": str(r.get("id")), "name": r.get("Account_Name"),
             "number": r.get("Inventory_Customer_Number")} for r in rows if r.get("id")]


# ------------------------------------------------------------------ overview / start
def _checked(db: Session, account_ids: list[str], today: datetime) -> set[str]:
    """Checked in the last 12 months: assessed (batch or Verify Account), or found with no
    documents (asking for documents is the next step, not checking again). Failed checks and
    accounts in an unfinished batch are not 'checked'."""
    if not account_ids:
        return set()
    since = today - timedelta(days=CHECK_AGAIN_DAYS)
    assessed = db.execute(select(VerificationJob.account_id)
                          .join(JobAssessment, JobAssessment.job_id == VerificationJob.id)
                          .where(VerificationJob.account_id.in_(account_ids),
                                 JobAssessment.created_at >= since)).all()
    empty = db.execute(select(VerificationJob.account_id)
                       .where(VerificationJob.account_id.in_(account_ids),
                              VerificationJob.status == JobStatus.NO_DOCUMENTS,
                              VerificationJob.created_at >= since)).all()
    return {r[0] for r in assessed} | {r[0] for r in empty}


def overview(db: Session, client, channel: str) -> dict:
    accounts = active_accounts(client, channel)
    checked = _checked(db, [a["id"] for a in accounts], datetime.now(UTC))
    last = db.scalar(select(BatchRun).where(BatchRun.channel == channel)
                     .order_by(BatchRun.created_at.desc()).limit(1))
    return {"channel": channel, "active": len(accounts), "checked": len(checked),
            "left": len(accounts) - len(checked),
            "last_batch": _batch_head(db, last) if last else None}


def start(db: Session, client, channel: str, size: int, by: str) -> BatchRun:
    running = db.scalar(select(BatchRun).where(BatchRun.status.in_(("Running", "Paused"))))
    if running:
        raise BatchError(f"Batch {running.number} ({running.channel}) is not finished yet; "
                         "finish or complete it first")
    size = max(1, min(int(size or 20), 200))
    accounts = active_accounts(client, channel)
    done = _checked(db, [a["id"] for a in accounts], datetime.now(UTC))
    left = [a for a in accounts if a["id"] not in done][:size]
    if not left:
        raise BatchError(f"No Active account of {channel} is left to check")
    batch = BatchRun(number=(db.scalar(select(func.max(BatchRun.number))) or 0) + 1,
                     channel=channel, size=len(left), status="Running", created_by=by)
    db.add(batch)
    db.flush()
    for i, a in enumerate(left, 1):
        db.add(BatchItem(batch_id=batch.id, position=i, account_id=a["id"],
                         account_name=a["name"], customer_number=a["number"]))
    record_event(db, "BATCH_STARTED", f"Batch {batch.number}: {len(left)} {channel} accounts",
                 None, {"batch_id": str(batch.id), "by": by})
    db.commit()
    return batch


# ------------------------------------------------------------------ progress
def _item_state(job: VerificationJob | None) -> str:
    if job is None:
        return "Waiting"
    if job.status == JobStatus.ASSESSED:
        return "Done"
    if job.status == JobStatus.NO_DOCUMENTS:
        return "No documents"
    if job.status == JobStatus.FAILED:
        return "Failed"
    return "Checking"


def result_of(assessment: dict | None, review: Review | None, today: date) -> dict:
    a = assessment or {}
    reqs = a.get("requirements") or []
    alerts = build_alerts(a, today) if a else []
    soon = [f"{label(r['document_type'])} ({r['valid_until']})" for r in reqs
            if r.get("valid_until") and r["status"] in ("VALID", "NO_EXPIRY")
            and 0 <= (date.fromisoformat(r["valid_until"]) - today).days <= 30]
    out = {
        "documents": len(a.get("document_data") or []),
        "missing": [label(r["document_type"]) for r in reqs if r["status"] == "MISSING"],
        "expired": [label(r["document_type"]) for r in reqs if r["status"] == "EXPIRED"],
        "expiring": soon,
        "wrong": [label(r["document_type"]) for r in reqs if r["status"] == "NOT_THIS_CUSTOMER"],
        "unreadable": sum(1 for x in alerts if x.get("code") == "UNREADABLE_DOCUMENT"),
        "needs_decision": bool(review and review.status in ("Pending Review", "In Review")),
        "recommendation": a.get("recommendation"),
    }
    out["ok"] = not (out["missing"] or out["expired"] or out["wrong"] or out["unreadable"]
                     or out["needs_decision"])
    out["request"] = bool(out["missing"] or out["expired"] or out["wrong"] or out["expiring"])
    return out


def refresh(db: Session, batch: BatchRun, today: date | None = None) -> None:
    """Item states from their jobs; results and review links once a job ends."""
    today = today or date.today()
    for item in db.scalars(select(BatchItem).where(BatchItem.batch_id == batch.id)):
        if item.job_id is None:
            continue
        job = db.get(VerificationJob, item.job_id)
        state = _item_state(job)
        if state != item.status or (state in TERMINAL and item.result is None):
            item.status, item.updated_at = state, utcnow()
            review = db.scalar(select(Review).where(Review.job_id == item.job_id))
            if review is not None:
                item.review_id = review.id
                review.batch_id = batch.id
            if state in TERMINAL:
                row = db.get(JobAssessment, item.job_id)
                item.result = result_of(row.assessment if row else None, review, today)
    items = db.scalars(select(BatchItem).where(BatchItem.batch_id == batch.id)).all()
    if batch.status == "Running" and items and all(i.status in TERMINAL for i in items):
        batch.status, batch.completed_at = "Completed", utcnow()
        record_event(db, "BATCH_COMPLETED", f"Batch {batch.number} completed", None,
                     {"batch_id": str(batch.id)})
    db.commit()


def advance(db: Session, enqueue, parallel: int = PARALLEL) -> dict:
    """Scheduler: keep at most `parallel` accounts of the running batch in progress."""
    from app.schemas import JobCreate
    from app.services.jobs import create_or_get_active_job
    started = 0
    for batch in db.scalars(select(BatchRun).where(BatchRun.status == "Running")).all():
        refresh(db, batch)
        if batch.status != "Running":
            continue
        items = db.scalars(select(BatchItem).where(BatchItem.batch_id == batch.id)
                           .order_by(BatchItem.position)).all()
        busy = sum(1 for i in items if i.status == "Checking")
        for item in items:
            if busy >= parallel:
                break
            if item.status != "Waiting" or item.job_id is not None:
                continue
            job, created = create_or_get_active_job(db, JobCreate(
                account_id=item.account_id, customer_number=item.customer_number or None,
                reason=f"Batch check {batch.number} ({batch.channel})", document_status="YES",
                source="batch"))
            if created:
                enqueue(str(job.id))
            item.job_id, item.status, item.updated_at = job.id, "Checking", utcnow()
            busy += 1
            started += 1
        db.commit()
    return {"started": started}


# ------------------------------------------------------------------ actions
def set_paused(db: Session, batch: BatchRun, paused: bool) -> None:
    if batch.status == "Completed":
        raise BatchError("This batch is completed")
    batch.status = "Paused" if paused else "Running"
    db.commit()


def complete(db: Session, batch: BatchRun) -> None:
    """Stop a batch early: accounts not started stay unchecked (they count as left)."""
    for item in db.scalars(select(BatchItem).where(BatchItem.batch_id == batch.id,
                                                   BatchItem.status == "Waiting")):
        db.delete(item)
    batch.status, batch.completed_at = "Completed", utcnow()
    db.commit()


def retry(db: Session, item: BatchItem) -> None:
    if item.status not in ("Failed", "No documents"):
        raise BatchError("Only failed accounts can be checked again")
    item.status, item.job_id, item.review_id, item.result = "Waiting", None, None, None
    batch = db.get(BatchRun, item.batch_id)
    if batch.status == "Completed":
        batch.status, batch.completed_at = "Running", None
    db.commit()


def spot_check(db: Session, review_id, verdict: str, note: str | None, by: str) -> BatchItem:
    if verdict not in ("Correct", "Not correct"):
        raise BatchError("Choose Correct or Not correct")
    if verdict == "Not correct" and not (note or "").strip():
        raise BatchError("Write what was not correct")
    item = db.scalar(select(BatchItem).where(BatchItem.review_id == review_id))
    if item is None:
        raise LookupError("This review is not part of a batch")
    item.spot_check, item.spot_note = verdict, (note or "").strip() or None
    item.spot_by, item.spot_at = by, utcnow()
    db.commit()
    return item


# ------------------------------------------------------------------ views
def _batch_head(db: Session, b: BatchRun) -> dict:
    counts = dict(db.execute(select(BatchItem.status, func.count()).where(
        BatchItem.batch_id == b.id).group_by(BatchItem.status)).all())
    total = sum(counts.values())
    return {"id": str(b.id), "number": b.number, "channel": b.channel, "status": b.status,
            "size": total, "done": sum(counts.get(s, 0) for s in TERMINAL), "counts": counts,
            "created_by": b.created_by,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "completed_at": b.completed_at.isoformat() if b.completed_at else None}


def list_batches(db: Session, limit: int = 50) -> list[dict]:
    return [_batch_head(db, b) for b in db.scalars(
        select(BatchRun).order_by(BatchRun.created_at.desc()).limit(limit))]


def report(db: Session, batch: BatchRun) -> dict:
    refresh(db, batch)
    items = db.scalars(select(BatchItem).where(BatchItem.batch_id == batch.id)
                       .order_by(BatchItem.position)).all()
    res = [i.result or {} for i in items]
    summary = {"ok": sum(1 for r in res if r.get("ok")),
               "missing": sum(1 for r in res if r.get("missing")),
               "expired": sum(1 for r in res if r.get("expired")),
               "expiring": sum(len(r.get("expiring") or []) for r in res),
               "unreadable": sum(1 for r in res if r.get("unreadable")),
               "wrong": sum(1 for r in res if r.get("wrong")),
               "needs_decision": sum(1 for r in res if r.get("needs_decision")),
               "spot_checked": sum(1 for i in items if i.spot_check),
               "spot_correct": sum(1 for i in items if i.spot_check == "Correct")}
    return {**_batch_head(db, batch), "summary": summary,
            "items": [{"id": str(i.id), "position": i.position, "account_id": i.account_id,
                       "account_name": i.account_name, "customer_number": i.customer_number,
                       "status": i.status, "review_id": str(i.review_id) if i.review_id else None,
                       "result": i.result, "spot_check": i.spot_check, "spot_note": i.spot_note,
                       "spot_by": i.spot_by} for i in items]}


def navigation(db: Session, review: Review) -> dict | None:
    """Batch N · account 7 of 20, with the previous and next accounts' reviews."""
    if not review.batch_id:
        return None
    batch = db.get(BatchRun, review.batch_id)
    items = db.scalars(select(BatchItem).where(BatchItem.batch_id == review.batch_id)
                       .order_by(BatchItem.position)).all()
    me = next((i for i in items if i.review_id == review.id), None)
    if batch is None or me is None:
        return None
    with_review = [i for i in items if i.review_id]
    k = with_review.index(me)
    return {"batch_id": str(batch.id), "number": batch.number, "channel": batch.channel,
            "position": me.position, "size": len(items),
            "previous": str(with_review[k - 1].review_id) if k > 0 else None,
            "next": str(with_review[k + 1].review_id) if k + 1 < len(with_review) else None,
            "spot_check": me.spot_check, "spot_note": me.spot_note, "spot_by": me.spot_by}
