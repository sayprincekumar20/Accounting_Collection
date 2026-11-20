import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import ACTIVE_JOB_STATUSES, JobStatus, VerificationJob
from app.schemas import JobCreate
from app.services.audit import record_event

STALE_AFTER = timedelta(minutes=30)


def find_active_job(db: Session, account_id: str) -> VerificationJob | None:
    """The Account's running job. One unfinished after 30 minutes (lost message, crashed
    worker) is closed as timed out, so the next click starts a new verification."""
    job = db.scalar(
        select(VerificationJob).where(
            VerificationJob.account_id == account_id,
            VerificationJob.status.in_([s.value for s in ACTIVE_JOB_STATUSES]),
        )
    )
    if job is not None and job.created_at is not None:
        created = job.created_at if job.created_at.tzinfo else job.created_at.replace(tzinfo=UTC)
        if datetime.now(UTC) - created > STALE_AFTER:
            job.status = JobStatus.FAILED
            job.error = "Timed out: the job did not finish within 30 minutes"
            job.completed_at = datetime.now(UTC)
            record_event(db, "JOB_TIMED_OUT", job.error, job.id)
            db.flush()
            try:
                from app.review.engine import create_problem_review
                if get_settings().engine_reviews:
                    create_problem_review(db, job, "Failed", job.error)
            except Exception:  # noqa: BLE001 - never block a new verification
                pass
            return None
    return job


def create_or_get_active_job(db: Session, req: JobCreate) -> tuple[VerificationJob, bool]:
    """Return (job, created). A second click while a job is running returns the same job."""
    existing = find_active_job(db, req.account_id)
    if existing:
        return existing, False

    who = req.requested_by
    job = VerificationJob(
        id=uuid.uuid4(),
        account_id=req.account_id,
        customer_number=req.customer_number,
        reason=req.reason,
        source=req.source,
        reported_document_status=req.document_status,
        reported_attachment_count=req.attachment_count,
        requested_by_user_id=who.id if who else None,
        requested_by_email=who.email if who else None,
        requested_at=req.requested_at,
        button_data={k: v for k, v in (("account", req.account),
                                       ("attachments", req.attachments),
                                       ("notes", req.notes),
                                       ("contacts", req.contacts)) if v is not None} or None,
    )
    db.add(job)
    try:
        db.flush()
    except IntegrityError:
        # Lost a race with a simultaneous request; the unique index kept us safe.
        db.rollback()
        existing = find_active_job(db, req.account_id)
        if existing:
            return existing, False
        raise
    record_event(db, "JOB_CREATED", "Verification requested", job.id,
                 req.model_dump(mode="json",
                                exclude={"account_id", "account", "attachments", "notes"})
                 | {"sent_by_button": sorted(k for k, v in (("account", req.account),
                                                            ("attachments", req.attachments),
                                                            ("notes", req.notes)) if v)})
    db.commit()
    return job, True
