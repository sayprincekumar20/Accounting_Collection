"""Batch check: Active accounts of one channel, 20 at a time, quietly."""

from datetime import date

import pytest

from app.assessment.alerts import build_alerts
from app.assessment.assess import assess
from app.db.models import BatchItem, BatchRun, JobAssessment, JobStatus, Review, VerificationJob
from app.review import batches as svc
from app.review.engine import create_engine_review
from app.storage.base import build_storage
from tests.test_assessment import SNAPSHOT, bir, dti, permit

TODAY = date(2026, 11, 25)
WET = "General Trade - Wet Market"


class Zoho:
    def __init__(self, n=25):
        self.accounts = [{"id": f"59062380000{i:08d}", "Account_Name": f"STALL {i}",
                          "Inventory_Customer_Number": f"RGFC-{i:05d}"} for i in range(n)]
        self.criteria = None

    def search_records(self, module, criteria):
        self.criteria = criteria
        return self.accounts

    def get_fields(self, module):
        return [{"api_name": "Channel", "pick_list_values": [
            {"display_value": "-None-"}, {"display_value": WET},
            {"display_value": "General Trade - Food Service"}]}]


def _matching(docs):
    """A Zoho record that already holds what the documents say (nothing to update)."""
    snap = {**SNAPSHOT, "Account_Name": "STALL"}
    for _ in range(3):
        for p in assess(snap, docs, TODAY)["proposals"]:
            if p["action"] in ("FILL", "CORRECT") and p.get("proposed_value"):
                snap[p["zoho_field"]] = p["proposed_value"]
    return snap


def _finish(db, settings, job, docs, snapshot=None):
    """Simulate the worker: assessment + review for a batch job."""
    job.account_snapshot = {**SNAPSHOT, "Account_Name": "STALL", **(snapshot or {})}
    a = assess(job.account_snapshot, docs, TODAY)
    a["alerts"] = build_alerts(a, TODAY)
    db.add(JobAssessment(job_id=job.id, rules_version="rules-1.5",
                         recommendation=a["recommendation"], assessment=a))
    job.status = JobStatus.ASSESSED
    db.commit()
    return create_engine_review(db, job, build_storage(settings))


def test_channels_come_from_the_picklist():
    assert svc.channels(Zoho()) == [WET, "General Trade - Food Service"]


def test_start_takes_20_active_accounts_and_runs_2_at_a_time(db):
    zoho, queued = Zoho(), []
    batch = svc.start(db, zoho, WET, 20, "Prince")
    assert zoho.criteria == f"((Customer_Status:equals:Active)and(Channel:equals:{WET}))"
    assert batch.size == 20 and db.query(BatchItem).count() == 20
    assert svc.advance(db, queued.append) == {"started": 2} and len(queued) == 2
    jobs = db.query(VerificationJob).all()
    assert {j.source for j in jobs} == {"batch"}
    assert svc.advance(db, queued.append) == {"started": 0}        # still 2 in progress
    with pytest.raises(svc.BatchError):                            # one batch at a time
        svc.start(db, zoho, WET, 20, "Prince")


def test_finished_accounts_get_results_and_the_batch_completes(db, settings):
    zoho, queued = Zoho(2), []
    batch = svc.start(db, zoho, WET, 20, "Prince")
    svc.advance(db, queued.append)
    jobs = db.query(VerificationJob).order_by(VerificationJob.created_at).all()
    docs = [bir(), dti(), permit()]
    ok_review = _finish(db, settings, jobs[0], docs, _matching(docs))
    problem = _finish(db, settings, jobs[1], [bir(tin="999-888-777-00000")],
                      {"Tax_Identification_Number_TIN": "123-456-789-00000"})
    assert ok_review.status == "No Action"            # nothing to decide: not counted as open
    assert problem.status == "Pending Review"         # another business's BIR: decide
    rep = svc.report(db, batch)
    assert rep["status"] == "Completed" and rep["done"] == 2
    first, second = rep["items"]
    assert first["status"] == "Done" and first["result"]["ok"] is True
    assert second["result"]["wrong"] and second["result"]["needs_decision"] is True
    assert db.get(Review, problem.id).batch_id == batch.id
    left = svc.overview(db, zoho, WET)
    assert left == {**left, "active": 2, "checked": 2, "left": 0}


def test_navigation_and_spot_check(db, settings):
    zoho, queued = Zoho(2), []
    svc.start(db, zoho, WET, 20, "Prince")
    svc.advance(db, queued.append)
    jobs = db.query(VerificationJob).order_by(VerificationJob.created_at).all()
    r1 = _finish(db, settings, jobs[0], [bir()])
    r2 = _finish(db, settings, jobs[1], [bir()])
    svc.report(db, db.query(BatchRun).one())
    nav = svc.navigation(db, r1)
    assert nav["position"] == 1 and nav["size"] == 2 and nav["next"] == str(r2.id)
    assert nav["previous"] is None
    with pytest.raises(svc.BatchError):
        svc.spot_check(db, r2.id, "Not correct", "", "Prince")      # a note is required
    item = svc.spot_check(db, r2.id, "Correct", None, "Prince")
    assert item.spot_check == "Correct"
    assert svc.report(db, db.query(BatchRun).one())["summary"]["spot_correct"] == 1


def test_pause_resume_and_retry(db):
    zoho, queued = Zoho(3), []
    batch = svc.start(db, zoho, WET, 20, "Prince")
    svc.set_paused(db, batch, True)
    assert svc.advance(db, queued.append) == {"started": 0}
    svc.set_paused(db, batch, False)
    svc.advance(db, queued.append)
    job = db.query(VerificationJob).first()
    job.status = JobStatus.FAILED
    db.commit()
    svc.refresh(db, batch)
    item = db.query(BatchItem).filter_by(job_id=job.id).one()
    assert item.status == "Failed"
    svc.retry(db, item)
    assert item.status == "Waiting" and item.job_id is None


def test_batch_jobs_are_quiet(db, settings):
    zoho, queued = Zoho(1), []
    svc.start(db, zoho, WET, 20, "Prince")
    svc.advance(db, queued.append)
    review = _finish(db, settings, db.query(VerificationJob).one(), [bir(), dti(), permit()])
    svc.report(db, db.query(BatchRun).one())
    from app.notify.events import notify_engine_review

    class N:
        enabled = True
        mailer = None
    assert notify_engine_review(db, db.get(Review, review.id), N()) is None   # no emails


def test_next_batch_takes_the_next_accounts_never_the_same(db, settings):
    zoho, queued = Zoho(5), []
    first = svc.start(db, zoho, WET, 2, "Prince")
    svc.advance(db, queued.append)
    jobs = db.query(VerificationJob).order_by(VerificationJob.created_at).all()
    _finish(db, settings, jobs[0], [bir()])
    jobs[1].status = JobStatus.NO_DOCUMENTS                 # nothing attached: still checked
    db.commit()
    assert svc.report(db, first)["status"] == "Completed"
    assert svc.overview(db, zoho, WET)["left"] == 3
    second = svc.start(db, zoho, WET, 2, "Prince")
    firsts = {i.account_id for i in db.query(BatchItem).filter_by(batch_id=first.id)}
    seconds = {i.account_id for i in db.query(BatchItem).filter_by(batch_id=second.id)}
    assert firsts.isdisjoint(seconds) and len(seconds) == 2


def test_account_with_no_documents_is_not_ok_and_can_be_requested(db, settings):
    """Meatplus Trading Corp / V AND A: nothing to read is never OK."""
    from app.review.requests import draft
    zoho, queued = Zoho(1), []
    batch = svc.start(db, zoho, WET, 20, "Prince")
    svc.advance(db, queued.append)
    job = db.query(VerificationJob).one()
    job.status = JobStatus.NO_DOCUMENTS
    job.account_snapshot = {**SNAPSHOT, "Account_Name": "MEATPLUS TRADING CORP",
                            "Owner": {"name": "CARLA", "email": "carla@example.com"}}
    db.commit()
    rep = svc.report(db, batch)
    r = rep["items"][0]["result"]
    assert r["ok"] is False and r["no_documents"] is True and r["request"] is True
    assert rep["summary"]["ok"] == 0 and rep["summary"]["no_documents"] == 1
    d = draft(db, job.account_id, "owner", "Prince")          # no previous reading needed
    assert {x["type"] for x in d["documents"]} == {"BIR_2303", "DTI_BN_CERT", "SEC_CERT",
                                                    "MAYORS_PERMIT"}
    assert "DTI (sole proprietor) or SEC (corporation)" in d["body"]
    assert d["to"] == "carla@example.com"
