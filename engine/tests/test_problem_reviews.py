"""Jobs that stop early (no downloadable documents, Zoho or reading errors) still show in the
dashboard as a closed review with the reason, and the requester gets an email."""

from contextlib import contextmanager

from app.db.models import Document, JobStatus, Review, VerificationJob
from app.notify.notifier import Notifier
from app.review.engine import create_problem_review, detail_view
from app.workers import tasks
from tests.test_notifications import Recorder

ACC = "5906238000080840012"


def _job(db):
    job = VerificationJob(account_id=ACC, status=JobStatus.NO_DOCUMENTS, reason="new client",
                          requested_by_email="rep@example.com", documents_found=0,
                          account_snapshot={"Account_Name": "ZOHO TEST COMP",
                                            "Owner": {"email": "owner@example.com"}})
    db.add(job)
    db.flush()
    db.add(Document(job_id=job.id, source="note", zoho_file_ref="99", file_name="permit.pdf",
                    status="DOWNLOAD_FAILED", status_detail="HTTP 400 from Zoho"))
    db.commit()
    return job


def test_problem_review_shows_reason_and_files(db):
    job = _job(db)
    r = create_problem_review(db, job, "Waiting for Documents", "No document could be downloaded")
    view = detail_view(r)
    assert view["status"] == "Waiting for Documents" and view["closed_at"]
    assert view["summary"]["alerts"] == "1. URGENT: No document could be downloaded"
    assert "permit.pdf: download failed - HTTP 400 from Zoho" in \
        view["summary"]["required_documents"]
    assert create_problem_review(db, job, "Failed", "again").id == r.id   # one per job


def test_task_helper_creates_review_and_emails(db, settings, monkeypatch):
    job = _job(db)
    rec = Recorder()

    @contextmanager
    def scope():
        yield db
    settings.engine_reviews = True
    settings.notify_verifications = True
    monkeypatch.setattr(tasks, "session_scope", scope)
    monkeypatch.setattr(tasks, "get_settings", lambda: settings)
    monkeypatch.setattr(Notifier, "from_settings", classmethod(lambda cls, s: cls(rec, rec, rec)))
    tasks._problem_review(job.id, "Waiting for Documents", "No document could be downloaded")
    review = db.query(Review).filter_by(job_id=job.id).one()
    assert review.status == "Waiting for Documents"
    mail = rec.emails[0]
    assert mail["subject"] == "Verification could not be completed: ZOHO TEST COMP"
    assert mail["to"] == ["rep@example.com"] and mail["cc"] == ["owner@example.com"]
    assert "to the Account as PDF or image files" in mail["text"]
    assert "permit.pdf: download failed" in mail["text"]
    assert rec.messages[0].startswith(f"⚠️ DV-{review.number} for ZOHO TEST COMP: not verified")
    tasks._problem_review(job.id, "Waiting for Documents", "again")      # sent once
    assert len(rec.emails) == 1


def test_nothing_when_dashboard_reviews_are_off(db, settings, monkeypatch):
    job = _job(db)

    @contextmanager
    def scope():
        yield db
    settings.engine_reviews = False
    monkeypatch.setattr(tasks, "session_scope", scope)
    monkeypatch.setattr(tasks, "get_settings", lambda: settings)
    tasks._problem_review(job.id, "Failed", "x")
    assert db.query(Review).count() == 0


def test_stuck_job_is_closed_and_a_new_click_starts_fresh(db, settings, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from app.schemas import JobCreate
    from app.services import jobs
    settings.engine_reviews = True
    monkeypatch.setattr(jobs, "get_settings", lambda: settings)
    old = VerificationJob(account_id=ACC, status=JobStatus.QUEUED,
                          created_at=datetime.now(UTC) - timedelta(hours=2))
    db.add(old)
    db.commit()
    req = JobCreate(account_id=ACC, reason="again", document_status="YES")
    job, created = jobs.create_or_get_active_job(db, req)
    assert created and job.id != old.id
    assert old.status == JobStatus.FAILED and "Timed out" in old.error
    assert db.query(Review).filter_by(job_id=old.id).one().status == "Failed"


def test_recent_running_job_is_still_returned(db, settings, monkeypatch):
    from app.schemas import JobCreate
    from app.services import jobs
    monkeypatch.setattr(jobs, "get_settings", lambda: settings)
    running = VerificationJob(account_id=ACC, status=JobStatus.READING)
    db.add(running)
    db.commit()
    job, created = jobs.create_or_get_active_job(db, JobCreate(account_id=ACC, reason="x",
                                                               document_status="YES"))
    assert not created and job.id == running.id


def test_token_cache_key_changes_with_the_zoho_credentials(settings):
    from app.zoho.auth import RedisTokenCache, credentials_fingerprint

    class FakeRedis:
        def __init__(self):
            self.data = {}

        def get(self, k):
            return self.data.get(k)

        def set(self, k, v, ex=None):
            self.data[k] = v
    r = FakeRedis()
    sandbox = RedisTokenCache(r, credentials_fingerprint(settings))
    sandbox.set("sandbox-access-token", 3600)
    settings.zoho_refresh_token = "a-new-production-refresh-token"
    production = RedisTokenCache(r, credentials_fingerprint(settings))
    assert production.get() is None                   # the old org's token is not reused
    assert sandbox.get() == "sandbox-access-token"
