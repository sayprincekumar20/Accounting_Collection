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
    assert "attached to the Account as PDF or image files" in mail["text"]
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
