"""Document requests: editable email to the Account Owner or the customer, secure upload link,
uploads attached to the Account in Zoho, then a new verification."""

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.api import requests as requests_api
from app.api.deps import get_enqueuer
from app.assessment.alerts import build_alerts
from app.assessment.assess import assess
from app.config import get_settings
from app.db.models import DocumentRequest, JobAssessment, JobStatus, Review, VerificationJob
from app.db.session import get_db
from app.main import create_app
from app.review.engine import create_engine_review
from app.storage.base import build_storage
from tests.test_assessment import SNAPSHOT, bir

ACC = "5906238000098272026"
KEY = {"X-API-Key": "test-key", "X-Reviewer": "Prince"}
CONTACTS = [{"name": "Glydel Galino", "email": "procurement@customer.ph", "primary": True,
             "roles": {}},
            {"name": "Other", "email": "other@customer.ph", "primary": False, "roles": {}}]


class Mailer:
    def __init__(self):
        self.sent = []

    def send(self, to, cc, subject, text, html=None):
        self.sent.append({"to": to, "cc": cc, "subject": subject, "text": text})
        return True


class Zoho:
    def __init__(self):
        self.files = []

    def upload_attachment(self, module, rid, name, data, content_type):
        self.files.append((module, rid, name, len(data)))
        return f"att-{len(self.files)}"


@pytest.fixture
def env(db, settings, monkeypatch):
    settings.dashboard_url = "https://accounting.example.com"
    job = VerificationJob(account_id=ACC, status=JobStatus.ASSESSED, reason="test",
                          requested_by_email="rep@example.com",
                          account_snapshot={**SNAPSHOT, "Account_Name": "SANDY MEAT SHOP",
                                            "Inventory_Customer_Number": "RGFC-03066",
                                            "Owner": {"name": "JHOANNA MAURICIO",
                                                      "email": "jhoanna@example.com"},
                                            "_contacts": CONTACTS})
    db.add(job)
    db.flush()
    a = assess({**SNAPSHOT, "_contacts": []}, [bir()], date(2026, 11, 24))   # DTI, permit missing
    a["alerts"] = build_alerts(a, date(2026, 11, 24))
    db.add(JobAssessment(job_id=job.id, rules_version="rules-1.4",
                         recommendation=a["recommendation"], assessment=a))
    db.commit()
    review = create_engine_review(db, job, build_storage(settings))
    db.commit()
    mailer, zoho, queued = Mailer(), Zoho(), []
    monkeypatch.setattr(requests_api, "get_settings", lambda: settings)
    monkeypatch.setattr("app.notify.gmail.GmailClient.from_settings", lambda s: mailer)
    monkeypatch.setattr("app.zoho.factory.get_zoho_client", lambda: zoho)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_enqueuer] = lambda: queued.append
    return TestClient(app), review, mailer, zoho, queued


def test_draft_for_the_account_owner_lists_what_is_needed(env):
    api, review, *_ = env
    d = api.get(f"/v1/requests/draft?account_id={ACC}&recipient=owner", headers=KEY).json()
    assert d["to"] == "jhoanna@example.com" and d["recipient_kind"] == "owner"
    assert d["subject"] == "Documents needed: SANDY MEAT SHOP"
    assert d["body"].startswith("Hello Jhoanna,") and "{{upload_link}}" in d["body"]
    assert "- DTI Business Name Certificate: not on file yet" in d["body"]
    assert "To complete the verification of SANDY MEAT SHOP" in d["body"]
    assert {x["type"] for x in d["documents"]} == {"DTI_BN_CERT", "MAYORS_PERMIT"}
    assert d["recipients"]["customer"]["email"] == "procurement@customer.ph"


def test_draft_for_the_customer_uses_the_primary_contact(env):
    api, *_ = env
    d = api.get(f"/v1/requests/draft?account_id={ACC}&recipient=customer", headers=KEY).json()
    assert d["to"] == "procurement@customer.ph" and d["cc"] == "jhoanna@example.com"
    assert d["body"].startswith("Dear Glydel Galino,")


def test_renewal_draft_for_one_document(env):
    api, *_ = env
    d = api.get(f"/v1/requests/draft?account_id={ACC}&documents=BIR_2303", headers=KEY).json()
    assert [x["type"] for x in d["documents"]] == ["BIR_2303"]


def test_send_emails_the_edited_text_with_the_link_and_closes_the_review(env, db):
    api, review, mailer, *_ = env
    d = api.get(f"/v1/requests/draft?account_id={ACC}", headers=KEY).json()
    r = api.post("/v1/requests", headers=KEY, json={
        "account_id": ACC, "recipient_kind": "owner", "to": d["to"], "cc": "",
        "subject": "Please collect: SANDY", "body": "Edited text.\n{{upload_link}}\nThanks",
        "documents": d["documents"], "review_id": str(review.id)})
    assert r.status_code == 200, r.text
    link = r.json()["link"]
    assert link.startswith("https://accounting.example.com/upload/") and len(link) > 70
    mail = mailer.sent[0]
    assert mail["to"] == ["jhoanna@example.com"] and mail["subject"] == "Please collect: SANDY"
    assert f"Edited text.\n{link}\nThanks" == mail["text"]
    db.refresh(review)
    assert review.status == "Waiting for Documents"
    assert "jhoanna@example.com" in review.reviewer_notes


def test_upload_page_shows_only_the_checklist_then_upload_and_verify(env, db):
    api, _, _, zoho, queued = env
    d = api.get(f"/v1/requests/draft?account_id={ACC}", headers=KEY).json()
    link = api.post("/v1/requests", headers=KEY, json={**{k: d[k] for k in (
        "to", "subject", "body", "documents")}, "account_id": ACC}).json()["link"]
    token = link.rsplit("/", 1)[1]
    page = api.get(f"/public/requests/{token}").json()             # no API key needed
    assert page["account_name"] == "SANDY MEAT SHOP" and page["open"]
    assert set(page) == {"account_name", "status", "documents", "expires_at", "open"}
    assert api.get("/public/requests/not-a-real-token-but-long-enough-xxxxx").status_code == 404
    bad = api.post(f"/public/requests/{token}/files", data={"document_type": "DTI_BN_CERT"},
                   files={"file": ("virus.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 409
    ok = api.post(f"/public/requests/{token}/files", data={"document_type": "DTI_BN_CERT"},
                  files={"file": ("dti.pdf", b"%PDF-1.4 x", "application/pdf")})
    assert ok.status_code == 200 and ok.json()["complete"] is False
    assert zoho.files[0][:2] == ("Accounts", ACC) and zoho.files[0][2].startswith("DTI")
    assert api.post(f"/public/requests/{token}/submit").json() == {"status": "Submitted"}
    assert len(queued) == 1
    req = db.query(DocumentRequest).one()
    assert req.status == "Submitted" and req.job_id is not None
    closed = api.post(f"/public/requests/{token}/files", data={"document_type": "MAYORS_PERMIT"},
                      files={"file": ("p.pdf", b"%PDF", "application/pdf")})
    assert closed.status_code == 409


def test_send_needs_a_recipient_and_documents(env):
    api, *_ = env
    r = api.post("/v1/requests", headers=KEY, json={"account_id": ACC, "to": "not-an-email",
                                                     "subject": "x", "body": "y",
                                                     "documents": [{"type": "BIR_2303"}]})
    assert r.status_code == 409
    assert Review is not None


def _send(api, documents=None):
    d = api.get(f"/v1/requests/draft?account_id={ACC}", headers=KEY).json()
    body = {**{k: d[k] for k in ("to", "subject", "body")}, "account_id": ACC,
            "documents": documents or d["documents"]}
    return api.post("/v1/requests", headers=KEY, json=body).json()


def test_uploading_every_requested_document_starts_the_check(env, db):
    api, _, _, _, queued = env
    sent = _send(api)
    token = sent["link"].rsplit("/", 1)[1]
    for t in ("DTI_BN_CERT", "MAYORS_PERMIT"):
        r = api.post(f"/public/requests/{token}/files", data={"document_type": t},
                     files={"file": (f"{t}.pdf", b"%PDF", "application/pdf")}).json()
    assert r["complete"] and r["submitted"] and len(queued) == 1
    job = db.query(VerificationJob).order_by(VerificationJob.created_at.desc()).first()
    assert job.requested_by_email == "rep@example.com"     # result to who verified it


def test_follow_up_checks_after_24_hours_and_reminds_once_after_3_days(env, db):
    from datetime import UTC, datetime, timedelta

    from app.review.requests import follow_up
    api, _, mailer, _, queued = env
    partly = _send(api)
    waiting = _send(api)
    token = partly["link"].rsplit("/", 1)[1]
    api.post(f"/public/requests/{token}/files", data={"document_type": "DTI_BN_CERT"},
             files={"file": ("dti.pdf", b"%PDF", "application/pdf")})
    later = datetime.now(UTC) + timedelta(days=4)
    done = follow_up(db, mailer, queued.append, later)
    assert done["checked"] == 1 and done["reminded"] == 1 and len(queued) == 1
    reminder = mailer.sent[-1]
    assert reminder["subject"].startswith("Reminder: ") and waiting["link"] in reminder["text"]
    again = follow_up(db, mailer, queued.append, later + timedelta(hours=1))
    assert again["reminded"] == 0                          # only one reminder
    expired = follow_up(db, mailer, queued.append, later + timedelta(days=20))
    assert expired["expired"] == 1


def test_list_shows_links_of_open_requests_and_resend(env):
    api, _, mailer, *_ = env
    sent = _send(api)
    items = api.get(f"/v1/requests?account_id={ACC}", headers=KEY).json()["items"]
    assert items[0]["link"] == sent["link"] and items[0]["status"] == "Requested"
    r = api.post(f"/v1/requests/{sent['id']}/resend", headers=KEY)
    assert r.status_code == 200 and len(mailer.sent) == 2



def test_renewal_wording_for_a_document_expiring_soon():
    from datetime import date

    from app.review.requests import link_days, needed_documents, template
    today = date(2026, 11, 24)
    a = {"requirements": [{"document_type": "MAYORS_PERMIT", "status": "VALID",
                           "valid_until": "2026-12-31"}]}
    docs = needed_documents(a, ["MAYORS_PERMIT"], today)
    assert docs[0]["kind"] == "expiring"
    assert docs[0]["reason"] == "expires on 31 Dec 2026 (in 37 days)"
    assert link_days(docs, 14, today) == 67                  # 30 days after it expires
    subject, body = template("owner", "RHAINHEART MEATSHOP", "RGFC-03057", docs,
                             "RICHARD BERNADOS", "Prince", date(2027, 1, 30))
    assert subject == "Renewal needed: Mayor's / Business Permit - RHAINHEART MEATSHOP"
    assert body.startswith("Hello Richard,\n\nThe Mayor's / Business Permit of RHAINHEART "
                           "MEATSHOP (RGFC-03057) expires on 31 Dec 2026 (in 37 days).")
    assert "so it is on file before the current one expires" in body
    assert "complete the verification" not in body and "((" not in body


def test_expired_wording_and_customer_version():
    from datetime import date

    from app.review.requests import needed_documents, template
    a = {"requirements": [{"document_type": "MAYORS_PERMIT", "status": "EXPIRED",
                           "valid_until": "2026-01-31"},
                          {"document_type": "BIR_2303", "status": "MISSING"}]}
    docs = needed_documents(a, None, date(2026, 11, 24))
    subject, body = template("owner", "GDRM", None, docs, "Jo", "Prince", date(2026, 12, 8))
    assert subject == "Documents needed: GDRM"
    assert "expired on 31 Jan 2026" in body and "GDRM also needs:" in body
    assert "- BIR Form 2303 (Certificate of Registration): not on file yet" in body
    subject, body = template("customer", "GDRM", None, docs[:1], "Glydel", "Prince",
                             date(2026, 12, 8))
    assert subject == "Document renewal for your account: GDRM"
    assert "following document has expired" in body and "keep your account up to date" in body


def test_renewal_offers_the_missing_documents_as_optional(env):
    api, *_ = env
    d = api.get(f"/v1/requests/draft?account_id={ACC}&documents=BIR_2303", headers=KEY).json()
    assert [x["type"] for x in d["documents"]] == ["BIR_2303"]          # only the renewal
    assert {x["type"] for x in d["optional_documents"]} == {"DTI_BN_CERT", "MAYORS_PERMIT"}
    assert "DTI" not in d["body"]                                       # not added by default
    both = api.get(f"/v1/requests/draft?account_id={ACC}&documents=BIR_2303,DTI_BN_CERT",
                   headers=KEY).json()
    assert {x["type"] for x in both["documents"]} == {"BIR_2303", "DTI_BN_CERT"}
    assert "also needs:" in both["body"] and "not on file yet" in both["body"]
    assert [x["type"] for x in both["optional_documents"]] == ["MAYORS_PERMIT"]
    full = api.get(f"/v1/requests/draft?account_id={ACC}", headers=KEY).json()
    assert full["optional_documents"] == []                 # Request documents: all ticked
