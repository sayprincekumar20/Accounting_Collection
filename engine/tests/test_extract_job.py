"""Phase 1C job step: extraction stored per file content, reused across jobs."""

import hashlib
import shutil
from datetime import date

import pytest

from app.db.models import (
    Document,
    DocumentExtraction,
    DocumentSource,
    DocumentStatus,
    JobStatus,
    StoredFile,
    VerificationJob,
)
from app.pipeline.extract import extract_job
from app.pipeline.read import read_job
from app.storage.base import LocalStorage, storage_key_for
from tests import synthetic_docs as sd
from tests.fake_vision import FakeVision

pytestmark = pytest.mark.skipif(shutil.which("tesseract") is None,
                                reason="Tesseract not installed")
VALUES = {"business_name": "EXAMPLE MARKET", "owner_name": "JUAN DELA CRUZ",
          "bn_number": "1234567", "valid_from": "11 May 2021", "valid_to": "11 May 2026",
          "territorial_scope": "CITY/MUNICIPALITY"}


def _job(db, storage, data, mime="image/png", ext="png"):
    sha = hashlib.sha256(data).hexdigest()
    if db.get(StoredFile, sha) is None:
        key = storage_key_for(sha, ext)
        storage.put(key, data, mime)
        db.add(StoredFile(sha256=sha, size_bytes=len(data), mime_type=mime, extension=ext,
                          storage_key=key))
    job = VerificationJob(account_id="1000000000000001", status=JobStatus.COLLECTED)
    db.add(job)
    db.flush()
    db.add(Document(job_id=job.id, source=DocumentSource.ATTACHMENT, zoho_file_ref="1",
                    file_name="IMG_0001.png", sha256=sha, status=DocumentStatus.STORED))
    db.commit()
    read_job(db, job, storage)
    return job, sha


def test_extract_job_stores_grounded_fields(db, settings):
    storage = LocalStorage(settings.storage_local_dir)
    job, sha = _job(db, storage, sd.to_bytes(sd.page_image()))
    extract_job(db, job, storage, FakeVision(VALUES, "DTI_BN_CERT"), today=date(2026, 10, 6))

    assert job.status == JobStatus.EXTRACTED
    row = db.query(DocumentExtraction).one()
    assert row.status == "EXTRACTED" and row.document_type == "DTI_BN_CERT"
    assert row.fields["bn_number"]["grounding"] == "EXACT"
    assert row.validity_status == "EXPIRED" and row.valid_until == "2026-05-11"
    assert row.input_tokens == 1000 and row.model == "fake-vision-1"


def test_unchanged_file_is_not_sent_to_the_model_again(db, settings):
    storage = LocalStorage(settings.storage_local_dir)
    data = sd.to_bytes(sd.page_image())
    first, _ = _job(db, storage, data)
    fake = FakeVision(VALUES, "DTI_BN_CERT")
    extract_job(db, first, storage, fake, today=date(2026, 10, 6))
    second, _ = _job(db, storage, data)
    extract_job(db, second, storage, fake, today=date(2026, 10, 6))
    assert len(fake.calls) == 1


def test_unreadable_file_is_skipped(db, settings):
    from PIL import Image
    storage = LocalStorage(settings.storage_local_dir)
    job, _ = _job(db, storage, sd.to_bytes(Image.new("RGB", (1200, 1600), "white")))
    fake = FakeVision(VALUES, "DTI_BN_CERT")
    extract_job(db, job, storage, fake, today=date(2026, 10, 6))
    assert db.query(DocumentExtraction).one().status == "SKIPPED" and not fake.calls


def test_photo_the_ocr_cannot_read_gets_an_ai_second_look(db, settings):
    """A photo of a permit plate (angled, little text): OCR says UNREADABLE, the AI reads it;
    the values go to a reviewer (READ_BY_AI_ONLY), they are never confirmed by OCR."""
    import numpy as np
    from PIL import Image
    storage = LocalStorage(settings.storage_local_dir)
    rng = np.random.default_rng(1)
    photo = Image.fromarray(rng.integers(0, 255, (1600, 1200, 3), dtype=np.uint8))
    job, _ = _job(db, storage, sd.to_bytes(photo))
    fake = FakeVision(VALUES, "DTI_BN_CERT")
    extract_job(db, job, storage, fake, today=date(2026, 10, 6))
    row = db.query(DocumentExtraction).one()
    assert fake.calls and row.status == "EXTRACTED"
    assert any(i["code"] == "READ_BY_AI_ONLY" for i in row.issues)


def test_skip_reason_is_kept():
    from app.assessment.alerts import build_alerts
    a = {"requirements": [], "proposals": [], "cross_document": [], "documents": [],
         "not_extracted": [{"file": "x.jpg", "status": "SKIPPED",
                            "error": "File was not readable: the file could not be opened"}]}
    alert = next(x for x in build_alerts(a, date(2026, 10, 6))
                 if x["code"] == "UNREADABLE_DOCUMENT")
    assert alert["message"] == "Could not read x.jpg: the file could not be opened"
