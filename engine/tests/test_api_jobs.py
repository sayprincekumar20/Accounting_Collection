import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_enqueuer
from app.db.session import get_db
from app.main import create_app
from tests.fakes import ACCOUNT_ID

HEADERS = {"X-API-Key": "test-key"}


@pytest.fixture
def api(db):
    app = create_app()
    queued: list[str] = []
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_enqueuer] = lambda: queued.append
    client = TestClient(app)
    client.queued = queued
    return client


def payload(**kw):
    return {
        "account_id": ACCOUNT_ID,
        "customer_number": "EXAMPLE-001",
        "reason": "Routine verification request",
        "document_status": "YES",
        "attachment_count": 3,
        "requested_by": {"id": "1000000000000003", "email": "reviewer@example.com"},
        "requested_at": "2026-10-05T15:36:00+08:00",
        "source": "crm_button",
        **kw,
    }


def test_rejects_missing_api_key(api):
    assert api.post("/v1/jobs", json=payload()).status_code == 401


def test_creates_and_queues_job(api):
    resp = api.post("/v1/jobs", json=payload(), headers=HEADERS)
    assert resp.status_code == 202
    body = resp.json()
    assert body["created"] is True and body["status"] == "QUEUED"
    assert api.queued == [body["job_id"]]


def test_second_click_returns_same_job(api):
    first = api.post("/v1/jobs", json=payload(), headers=HEADERS).json()
    second = api.post("/v1/jobs", json=payload(), headers=HEADERS)
    assert second.status_code == 200
    assert second.json()["job_id"] == first["job_id"]
    assert second.json()["created"] is False
    assert len(api.queued) == 1


def test_blank_reason_allowed(api):
    resp = api.post("/v1/jobs", json=payload(reason=""), headers=HEADERS)
    assert resp.status_code == 202


def test_invalid_account_id(api):
    resp = api.post("/v1/jobs", json=payload(account_id="abc"), headers=HEADERS)
    assert resp.status_code == 422


def test_get_job(api):
    job_id = api.post("/v1/jobs", json=payload(), headers=HEADERS).json()["job_id"]
    resp = api.get(f"/v1/jobs/{job_id}", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["reason"] == "Routine verification request"
    assert resp.json()["documents"] == []
    assert resp.json()["reported_attachment_count"] == 3
    assert resp.json()["requested_by_email"] == "reviewer@example.com"


def test_workflow_trigger_skips_an_account_verified_in_the_last_24_hours(api, db):
    """The engine's own activation (or a repeated Zoho trigger) must not start a second check."""
    from app.db.models import JobStatus, VerificationJob
    first = api.post("/v1/jobs", json=payload(), headers=HEADERS)          # Verify Account
    job = db.get(VerificationJob, __import__("uuid").UUID(first.json()["job_id"]))
    job.status = JobStatus.ASSESSED                                          # done, activated
    db.commit()
    again = api.post("/v1/jobs", json=payload(source="workflow",
                                              reason="Customer Status changed to Active"),
                     headers=HEADERS)
    assert again.status_code == 200 and again.json()["created"] is False
    assert "Verified recently" in again.json()["message"] and len(api.queued) == 1


def test_workflow_trigger_checks_an_account_not_verified_recently(api):
    resp = api.post("/v1/jobs", json=payload(source="workflow"), headers=HEADERS)
    assert resp.status_code == 202 and resp.json()["created"] is True and len(api.queued) == 1


def test_button_is_never_skipped(api, db):
    from app.db.models import JobStatus, VerificationJob
    first = api.post("/v1/jobs", json=payload(), headers=HEADERS)
    job = db.get(VerificationJob, __import__("uuid").UUID(first.json()["job_id"]))
    job.status = JobStatus.ASSESSED
    db.commit()
    again = api.post("/v1/jobs", json=payload(), headers=HEADERS)            # a person clicks
    assert again.status_code == 202 and len(api.queued) == 2
