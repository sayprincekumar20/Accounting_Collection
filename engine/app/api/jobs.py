import uuid
from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_enqueuer, require_api_key
from app.config import get_settings
from app.db.models import FieldUpdate, JobAssessment, VerificationJob
from app.db.session import get_db
from app.schemas import JobCreate, JobCreated, JobOut
from app.services.jobs import create_or_get_active_job

router = APIRouter(prefix="/v1/jobs", tags=["jobs"], dependencies=[Depends(require_api_key)])


@router.post("", response_model=JobCreated, status_code=status.HTTP_202_ACCEPTED)
def create_job(
    req: JobCreate,
    response: Response,
    db: Session = Depends(get_db),
    enqueue: Callable[[str], None] = Depends(get_enqueuer),
) -> JobCreated:
    if req.source == "workflow":     # Customer Status changed to Active in Zoho
        recent = recently_verified(db, req.account_id, get_settings().workflow_skip_hours)
        if recent is not None:
            response.status_code = status.HTTP_200_OK
            return JobCreated(job_id=recent.id, status=recent.status, created=False,
                              message="Verified recently; no new check (activation by the "
                                      "verification itself, or a repeated trigger).")
    job, created = create_or_get_active_job(db, req)
    if created:
        enqueue(str(job.id))
        message = f"Verification started ({job.id}). Results will appear for review."
    else:
        response.status_code = status.HTTP_200_OK
        message = f"Verification already in progress ({job.id})."
    return JobCreated(job_id=job.id, status=job.status, created=created, message=message)


def recently_verified(db: Session, account_id: str, hours: int) -> VerificationJob | None:
    """The account's last verification if it finished (or started) within `hours`."""
    from datetime import UTC, datetime, timedelta
    since = datetime.now(UTC) - timedelta(hours=hours)
    return db.scalar(select(VerificationJob).where(
        VerificationJob.account_id == account_id, VerificationJob.created_at >= since)
        .order_by(VerificationJob.created_at.desc()).limit(1))


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: uuid.UUID, db: Session = Depends(get_db)) -> VerificationJob:
    job = db.get(VerificationJob, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


@router.get("/{job_id}/assessment")
def get_assessment(job_id: uuid.UUID, db: Session = Depends(get_db)) -> dict:
    """Phase 1D result: recommendation, reasons, requirements, cross-document checks and the
    proposed Zoho changes (FILL / CORRECT / MATCH / HOLD / ...) with their evidence."""
    row = db.get(JobAssessment, job_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No assessment for this job yet")
    return {"job_id": str(job_id), "recommendation": row.recommendation,
            "rules_version": row.rules_version, **row.assessment}


@router.get("/{job_id}/updates")
def get_updates(job_id: uuid.UUID, db: Session = Depends(get_db)) -> list[dict]:
    """Automatic Zoho updates for this job (or shadow-mode 'would update' records)."""
    rows = db.scalars(select(FieldUpdate).where(FieldUpdate.job_id == job_id)
                      .order_by(FieldUpdate.created_at)).all()
    return [{"field": r.zoho_field, "action": r.action, "old_value": r.old_value,
             "new_value": r.new_value, "confidence": r.confidence, "grounding": r.grounding,
             "mode": r.mode, "status": r.status, "detail": r.detail,
             "created_at": r.created_at.isoformat()} for r in rows]
