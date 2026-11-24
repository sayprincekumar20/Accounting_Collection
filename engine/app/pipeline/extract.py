"""Phase 1C job step: extract fields from every read document (cached per content + version)."""

import logging
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Document,
    DocumentExtraction,
    DocumentStatus,
    FilePage,
    FileReading,
    JobStatus,
    StoredFile,
    VerificationJob,
)
from app.extraction.extract import PageInput, extract_document
from app.extraction.prompts import EXTRACTION_PROMPT_VERSION
from app.extraction.providers import (
    ExtractionError,
    TransientExtractionError,
    VisionProvider,
)
from app.extraction.spreadsheet import DOCUMENT_TYPE as CIS_TYPE
from app.extraction.spreadsheet import extract_customer_info_sheet
from app.pipeline.read import PIPELINE_VERSION
from app.services.audit import record_event
from app.storage.base import Storage

log = logging.getLogger(__name__)
MANILA = timezone(timedelta(hours=8))


def manila_today() -> date:
    return datetime.now(MANILA).date()


def extraction_version(provider: VisionProvider) -> str:
    return f"{EXTRACTION_PROMPT_VERSION}|{provider.name}:{provider.model}|{PIPELINE_VERSION}"


def _has_picture(storage: Storage, key: str | None) -> bool:
    """A real photo has contrast; an empty page (white, black, one colour) does not. Blank pages
    are not worth an AI call."""
    if not key:
        return False
    try:
        import io

        import numpy as np
        from PIL import Image
        img = Image.open(io.BytesIO(storage.get(key))).convert("L")
        img.thumbnail((400, 400))
        return float(np.asarray(img).std()) > 8.0
    except Exception:  # noqa: BLE001 - when in doubt, no second look
        return False


def extract_file(db: Session, storage: Storage, sha256: str, provider: VisionProvider,
                 today: date) -> DocumentExtraction:
    version = extraction_version(provider)
    existing = db.get(DocumentExtraction, (sha256, version))
    if existing is not None and existing.status == "EXTRACTED":
        return existing

    reading = db.get(FileReading, (sha256, PIPELINE_VERSION))
    row = existing or DocumentExtraction(sha256=sha256, extraction_version=version)
    pages = db.scalars(select(FilePage).where(
        FilePage.sha256 == sha256, FilePage.pipeline_version == PIPELINE_VERSION)
        .order_by(FilePage.page_number)).all() if reading is not None else []
    # Second look: a photo the OCR could not read (angled, metal plate, low light) still has its
    # page images; the vision model reads them. Its values cannot be confirmed by OCR, so they go
    # to a reviewer and are never written automatically.
    second_look = (reading is not None and reading.status == "UNREADABLE"
                   and any(_has_picture(storage, p.image_key) for p in pages))
    if reading is None or (reading.status != "READ" and not second_look):
        reason = (reading.error if reading is not None and reading.error else
                  "the file could not be opened or read")
        row.status, row.error = "SKIPPED", f"File was not readable: {reason}"[:1000]
        db.merge(row)
        db.flush()
        return row

    if reading.document_type == CIS_TYPE:
        stored = db.get(StoredFile, sha256)
        sheet = extract_customer_info_sheet(storage.get(stored.storage_key))
        row.status, row.error = "EXTRACTED", None
        row.expected_type = row.model_type = row.document_type = CIS_TYPE
        row.fields, row.other_fields = sheet["fields"], sheet["other_fields"]
        row.issues, row.validity_status, row.valid_until = [], "NO_EXPIRY", None
        row.model, row.calls, row.seconds = "spreadsheet-cells", 0, 0.0
        row.input_tokens = row.output_tokens = 0
        row = db.merge(row)
        db.flush()
        return row

    inputs = [PageInput(storage.get(p.image_key), p.grounding_text, p.quality_label)
              for p in pages if second_look or p.quality_label != "UNREADABLE"]
    try:
        result = extract_document(inputs, reading.document_type or "OTHER", provider, today)
    except TransientExtractionError:
        raise  # worker retries the job later
    except ExtractionError as exc:
        row.status, row.error = "FAILED", (("Photo too poor for OCR and the AI could not read "
                                            "it either: ") if second_look else "") + str(exc)[:900]
        row.expected_type = reading.document_type
        db.merge(row)
        db.flush()
        return row

    row.status, row.error = "EXTRACTED", None
    row.expected_type, row.model_type = result.expected_type, result.model_type
    row.document_type = result.document_type
    row.fields = {k: asdict(v) for k, v in result.fields.items()}
    row.other_fields = result.other_fields
    row.issues = list(result.issues or [])
    if second_look:
        reasons = sorted({r for p in pages for r in (p.quality_reasons or [])})
        row.issues.append({"code": "READ_BY_AI_ONLY", "severity": "INFO",
                           "message": "Photo too poor for OCR (" + (", ".join(reasons) or
                                                                     "little readable text")
                                      + "); read by the AI only: compare the values with "
                                        "the photo"})
    if result.document_type in (None, "OTHER") and not any(
            (v.value if hasattr(v, "value") else None) for v in result.fields.values()):
        row.issues.append({"code": "NOT_A_BUSINESS_DOCUMENT", "severity": "INFO",
                           "message": "Not recognised as a business document"})
    row.validity_status, row.valid_until = result.validity_status, result.valid_until
    row.model, row.calls, row.seconds = result.model, result.calls, result.seconds
    row.input_tokens, row.output_tokens = result.input_tokens, result.output_tokens
    row = db.merge(row)
    db.flush()
    return row


def extract_job(db: Session, job: VerificationJob, storage: Storage, provider: VisionProvider,
                today: date | None = None) -> VerificationJob:
    today = today or manila_today()
    job.status = JobStatus.EXTRACTING
    db.commit()
    docs = db.scalars(select(Document).where(Document.job_id == job.id,
                                             Document.status == DocumentStatus.STORED)).all()
    summary = []
    for doc in docs:
        row = extract_file(db, storage, doc.sha256, provider, today)
        summary.append({"file": doc.file_name, "status": row.status, "type": row.document_type,
                        "validity": row.validity_status,
                        "issues": [i["code"] for i in (row.issues or [])
                                   if i.get("severity") != "INFO"]})
        db.commit()
    job.status = JobStatus.EXTRACTED
    record_event(db, "EXTRACTION_FINISHED", f"{len(docs)} document(s) extracted", job.id,
                 {"documents": summary, "extraction_version": extraction_version(provider)})
    db.commit()
    return job
