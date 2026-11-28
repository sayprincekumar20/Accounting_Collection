import pytest
from sqlalchemy import select

from app.api.approvals import get_n8n_tables
from app.models import AuditLog, IssueEvent
from tests.fakes import FakeTables

ACTOR = {"X-Acting-User": "Mar%C3%ADa%20Santos"}
ENTRY = "ZOHO FORM TEST ACCOUNT___pk8543264@gmail.com-1792978261646"


@pytest.fixture()
def world(db, client):
    tables = FakeTables(
        {
            "escalations": [
                {
                    "id": 118,
                    "entry_id": ENTRY,
                    "client_id": "ZOHO FORM TEST ACCOUNT___x",
                    "status": None,
                    "handled_by": None,
                }
            ],
            "issue_log": [],
        }
    )
    client.app.dependency_overrides[get_n8n_tables] = lambda: tables
    return client, tables, db


def go_core(client):
    assert (
        client.put("/v1/switches/wave1.escalations", json={"mode": "core"}, headers=ACTOR).status_code == 200
    )


def test_while_the_switch_is_on_n8n_a_real_change_is_refused_and_nothing_changes(world):
    client, tables, db = world
    r = client.post(
        "/v1/escalations/status", json={"entry_id": ENTRY, "status": "DONE", "note": "x"}, headers=ACTOR
    )
    assert r.status_code == 409
    assert tables.tables["escalations"][0]["status"] is None
    r = client.post(
        "/v1/issues/events",
        json={"issue_id": ENTRY, "issue_kind": "ESCALATION", "event": "NOTE", "summary": "x"},
        headers=ACTOR,
    )
    assert r.status_code == 409 and db.scalars(select(IssueEvent)).all() == []


def test_dry_run_reports_what_would_happen_and_changes_nothing(world):
    client, tables, db = world
    r = client.post(
        "/v1/escalations/status",
        json={"entry_id": ENTRY, "status": "in_progress", "dry_run": True},
        headers=ACTOR,
    )
    assert r.status_code == 200 and r.json() == {"ok": True, "updated": 1, "dry_run": True}
    assert tables.tables["escalations"][0]["status"] is None
    assert (
        db.scalars(select(AuditLog).where(AuditLog.action == "escalation.status_dry_run")).one().actor
        == "María Santos"
    )
    r = client.post(
        "/v1/issues/events",
        json={
            "issue_id": ENTRY,
            "issue_kind": "escalation",
            "event": "note",
            "summary": "s",
            "dry_run": True,
        },
        headers=ACTOR,
    )
    assert r.status_code == 200 and tables.tables["issue_log"] == []


def test_a_status_change_updates_the_row_with_the_acting_name_and_is_audited(world):
    client, tables, db = world
    go_core(client)
    r = client.post(
        "/v1/escalations/status",
        json={"entry_id": ENTRY, "status": "done", "note": "Documents sent"},
        headers=ACTOR,
    )
    assert r.status_code == 200 and r.json() == {"ok": True, "updated": 1, "dry_run": False}
    row = tables.tables["escalations"][0]
    assert (
        row["status"] == "DONE" and row["handled_by"] == "María Santos" and row["ar_note"] == "Documents sent"
    )
    assert row["handled_at"].endswith("+08:00")
    log = db.scalars(select(AuditLog).where(AuditLog.action == "escalation.status")).one()
    assert log.subject_id == ENTRY and log.detail["from"] is None and log.detail["to"] == "DONE"


def test_an_unknown_escalation_updates_nothing_and_says_so(world):
    client, tables, db = world
    go_core(client)
    r = client.post("/v1/escalations/status", json={"entry_id": "NOPE", "status": "OPEN"}, headers=ACTOR)
    assert r.status_code == 200 and r.json()["updated"] == 0


def test_if_n8n_cannot_be_written_the_caller_is_told_that_nothing_changed(world):
    client, tables, db = world
    go_core(client)
    tables.fail_on = "update"
    r = client.post("/v1/escalations/status", json={"entry_id": ENTRY, "status": "DONE"}, headers=ACTOR)
    assert r.status_code == 502 and r.json()["detail"]["saved_in_backend"] is False
    assert tables.tables["escalations"][0]["status"] is None


def test_a_history_line_is_stored_here_mirrored_to_n8n_and_readable(world):
    client, tables, db = world
    go_core(client)
    event = {"issue_id": ENTRY, "issue_kind": "ESCALATION", "ref": "ZOHO FORM TEST ACCOUNT-20261026-093101", "event": "diagnosis",
             "summary": "Paid claim: check Zoho Books", "detail": {"type": "Paid claim"}, "actor": "AI assistant (asked by María Santos)"}  # fmt: skip
    r = client.post("/v1/issues/events", json=event, headers=ACTOR)
    assert r.status_code == 200 and r.json() == {"ok": True, "dry_run": False}
    stored = db.scalars(select(IssueEvent)).one()
    assert stored.event == "DIAGNOSIS" and stored.actor == "AI assistant (asked by María Santos)"
    (mirrored,) = tables.tables["issue_log"]
    assert (
        mirrored["detail"] == '{"type":"Paid claim"}'
        and mirrored["timestamp"].endswith("Z")
        and mirrored["issue_kind"] == "ESCALATION"
    )
    items = client.get("/v1/issues/history", params={"issue_id": ENTRY}).json()["items"]
    assert [(i["event"], i["summary"]) for i in items] == [("DIAGNOSIS", "Paid claim: check Zoho Books")]


def test_when_no_actor_is_given_the_acting_name_is_used_and_a_mirror_failure_keeps_the_line_here(world):
    client, tables, db = world
    go_core(client)
    tables.fail_on = "insert"
    r = client.post(
        "/v1/issues/events",
        json={
            "issue_id": ENTRY,
            "issue_kind": "SYSTEM",
            "event": "ACTION",
            "summary": "Statement PDF made again",
        },
        headers=ACTOR,
    )
    assert r.status_code == 502 and r.json()["detail"]["saved_in_backend"] is True
    assert db.scalars(select(IssueEvent)).one().actor == "María Santos"


def test_bad_requests_are_refused(world):
    client, tables, db = world
    go_core(client)
    bad_status = client.post(
        "/v1/escalations/status", json={"entry_id": ENTRY, "status": "CLOSED"}, headers=ACTOR
    )
    blank = client.post(
        "/v1/issues/events",
        json={"issue_id": ENTRY, "issue_kind": "SYSTEM", "event": "NOTE", "summary": "   "},
        headers=ACTOR,
    )
    bad_event = client.post(
        "/v1/issues/events",
        json={"issue_id": ENTRY, "issue_kind": "SYSTEM", "event": "SEND", "summary": "x"},
        headers=ACTOR,
    )
    assert (bad_status.status_code, blank.status_code, bad_event.status_code) == (422, 422, 422)
    assert (
        client.post("/v1/escalations/status", json={"entry_id": ENTRY, "status": "DONE"}).status_code == 400
    )
