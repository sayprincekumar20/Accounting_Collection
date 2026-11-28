import threading

import pytest
from sqlalchemy import select

from app.api.approvals import get_n8n_hooks, get_n8n_tables
from app.domain.common import dumps, parse_json
from app.main import create_app
from app.models import Approval, ApprovalBatch, AuditLog

CLIENT = "ZOHO FORM TEST ACCOUNT___pk8543264@gmail.com"
ACTOR = {"X-Acting-User": "Prince%20Kumar"}


def inv(number, bal):
    return {"invoice_number": number, "balance": bal, "amount": bal, "status": "OVERDUE"}


def clients_table():
    return [
        {
            "id": 1, "client_id": CLIENT, "client_name": "ZOHO FORM TEST ACCOUNT", "collection_amount": 311.12,
            "overdue_total": 311.12, "current_total": 0, "invoice_numbers": "TEst, test sampleee, ONGOING TEST",
            "excluded_invoices_data": "",
            "branches_data": dumps([{
                "branch_name": "ZOHO FORM TEST ACCOUNT", "collection_amount": 311.12, "overdue_total": 311.12, "current_total": 0,
                "invoice_details": dumps([inv("TEst", 10), inv("test sampleee", 1.12), inv("ONGOING TEST", 300)]),
            }]),
        }
    ]  # fmt: skip


class FakeTables:
    def __init__(self, tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.calls = []
        self.fail_on = None
        self._lock = threading.Lock()

    def get_rows(self, table, column, value):
        with self._lock:
            self.calls.append(("get", table, value))
            return [dict(r) for r in self.tables.get(table, []) if str(r.get(column)) == value]

    def insert(self, table, rows):
        if self.fail_on == "insert":
            raise RuntimeError("n8n is down")
        with self._lock:
            self.calls.append(("insert", table, len(rows)))
            self.tables.setdefault(table, []).extend(dict(r) for r in rows)

    def update(self, table, column, value, data):
        if self.fail_on == "update":
            raise RuntimeError("n8n is down")
        with self._lock:
            self.calls.append(("update", table, value))
            for r in self.tables.get(table, []):
                if str(r.get(column)) == value:
                    r.update(data)


class FakeHooks:
    def __init__(self):
        self.calls = []
        self.fail = False

    def regenerate_pdfs(self, client_ids, requested_by):
        if self.fail:
            raise RuntimeError("webhook not published")
        self.calls.append((client_ids, requested_by))
        return len(client_ids)


@pytest.fixture()
def world(db, client):
    tables = FakeTables({"clients": clients_table(), "approvals": [], "approval_batches": []})
    hooks = FakeHooks()
    client.app.dependency_overrides[get_n8n_tables] = lambda: tables
    client.app.dependency_overrides[get_n8n_hooks] = lambda: hooks
    return client, tables, hooks, db


def go_core(client):
    r = client.put("/v1/switches/wave1.dashboard_actions", json={"mode": "core"}, headers=ACTOR)
    assert r.status_code == 200


def body(**over):
    return {
        "items": [
            {
                "client_id": CLIENT,
                "client_name": "ZOHO FORM TEST ACCOUNT",
                "approved": True,
                "excluded_invoices": ["ONGOING TEST"],
            }
        ],
        **over,
    }


def test_while_the_switch_is_on_n8n_a_real_approval_is_refused_and_nothing_changes(world):
    client, tables, hooks, db = world
    r = client.post("/v1/approvals", json=body(), headers=ACTOR)
    assert r.status_code == 409 and "still go through n8n" in r.json()["detail"]
    assert tables.tables["approvals"] == [] and db.scalars(select(Approval)).all() == []


def test_dry_run_records_the_plan_and_writes_nothing_anywhere(world):
    client, tables, hooks, db = world
    r = client.post("/v1/approvals", json=body(dry_run=True), headers=ACTOR)
    out = r.json()
    assert r.status_code == 200 and out["dry_run"] is True and out["selection_updated"] == [CLIENT]
    assert tables.tables["approvals"] == [] and tables.tables["clients"][0]["collection_amount"] == 311.12
    assert hooks.calls == [] and db.scalars(select(Approval)).all() == []
    log = db.scalars(select(AuditLog).where(AuditLog.action == "approvals.dry_run")).one()
    assert log.actor == "Prince Kumar" and log.detail["approved"] == 1


def test_an_approval_in_core_mode_is_saved_here_mirrored_to_n8n_and_the_pdf_is_requested(world):
    client, tables, hooks, db = world
    go_core(client)
    r = client.post("/v1/approvals", json=body(), headers=ACTOR)
    out = r.json()
    assert (
        r.status_code == 200
        and out["ok"]
        and out["saved"] == 1
        and out["pdf_requested"] == 1
        and out["warnings"] == []
    )

    # here: the approval, its batch and an audit line, all stamped with the acting name
    a = db.scalars(select(Approval)).one()
    assert a.company_key == "zoho form test account" and a.approved and a.approved_by == "Prince Kumar"
    assert a.excluded_invoices == ["ONGOING TEST"]
    batch = db.scalars(select(ApprovalBatch)).one()
    assert (
        batch.approved_by == "Prince Kumar"
        and float(batch.balance_at_approval) == 311.12
        and batch.client_count == 1
    )
    assert (
        db.scalars(select(AuditLog).where(AuditLog.action == "approvals.saved")).one().actor == "Prince Kumar"
    )

    # n8n's tables got what workflow 28 would have written
    (row,) = tables.tables["approvals"]
    assert (
        row["company_key"] == "zoho form test account"
        and row["approved_by"] == "Prince Kumar"
        and row["excluded_invoices"] == '["ONGOING TEST"]'
    )
    (nb,) = tables.tables["approval_batches"]
    assert nb["batch_id"] == batch.batch_id and nb["balance_at_approval"] == 311.12
    c = tables.tables["clients"][0]
    assert c["collection_amount"] == 11.12 and c["invoice_numbers"] == "TEst, test sampleee"
    assert [e["invoice"]["invoice_number"] for e in parse_json(c["excluded_invoices_data"], [])] == [
        "ONGOING TEST"
    ]
    assert hooks.calls == [([CLIENT], "Prince Kumar")]


def test_approving_again_updates_the_company_instead_of_adding_a_second_row_and_removal_restores_the_invoices(
    world,
):
    client, tables, hooks, db = world
    go_core(client)
    client.post("/v1/approvals", json=body(), headers=ACTOR)
    client.post(
        "/v1/approvals",
        json={"items": [{"client_id": CLIENT, "approved": False}]},
        headers={"X-Acting-User": "Ana"},
    )
    assert len(tables.tables["approvals"]) == 1 and len(db.scalars(select(Approval)).all()) == 1
    row = tables.tables["approvals"][0]
    assert row["approved"] is False and row["approved_by"] == "Ana" and row["excluded_invoices"] == ""
    c = tables.tables["clients"][0]
    assert c["collection_amount"] == 311.12 and c["excluded_invoices_data"] == ""
    assert len(db.scalars(select(ApprovalBatch)).all()) == 1  # a removal is not a batch


def test_if_writing_to_n8n_fails_the_approval_stays_saved_here_and_the_caller_is_told(world):
    client, tables, hooks, db = world
    go_core(client)
    tables.fail_on = "insert"
    r = client.post("/v1/approvals", json=body(), headers=ACTOR)
    assert r.status_code == 502 and r.json()["detail"]["saved_in_backend"] is True
    assert db.scalars(select(Approval)).one().approved is True
    assert (
        db.scalars(select(AuditLog).where(AuditLog.action == "approvals.mirror_failed")).one().actor
        == "Prince Kumar"
    )
    assert hooks.calls == []  # no PDF is requested for an approval n8n has not seen


def test_a_pdf_hook_problem_is_a_warning_not_a_failure(world):
    client, tables, hooks, db = world
    go_core(client)
    hooks.fail = True
    r = client.post("/v1/approvals", json=body(), headers=ACTOR)
    assert r.status_code == 200 and r.json()["pdf_requested"] == 0
    assert "Statement PDFs were not started" in r.json()["warnings"][0]
    assert tables.tables["approvals"][0]["approved"] is True


def test_unknown_clients_are_reported_and_bad_requests_are_refused(world):
    client, tables, hooks, db = world
    go_core(client)
    r = client.post(
        "/v1/approvals",
        json={"items": [{"client_id": "GHOST___x", "approved": True, "excluded_invoices": []}]},
        headers=ACTOR,
    )
    assert r.json()["skipped"] == [{"client_id": "GHOST___x", "reason": "client row not found"}]
    assert client.post("/v1/approvals", json={"items": []}, headers=ACTOR).status_code == 422
    assert client.post("/v1/approvals", json=body()).status_code == 400  # no acting name
    assert (
        client.post("/v1/approvals", json=body(), headers={"X-API-Key": "wrong", **ACTOR}).status_code == 401
    )


def test_the_real_app_object_uses_the_same_routes():
    assert "/v1/approvals" in create_app().openapi()["paths"]
