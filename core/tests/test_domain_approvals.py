from datetime import UTC, datetime

from app.domain.approvals import approval_rows, iso_z, plan_approvals
from app.domain.common import dumps, parse_json

AT = "2026-11-28T03:00:00.123Z"
CLIENT = "ZOHO FORM TEST ACCOUNT___pk8543264@gmail.com"


def inv(number, bal, status="OVERDUE"):
    return {"invoice_number": number, "balance": bal, "amount": bal, "status": status}


def client_row(**over):
    """The test account as n8n holds it before any selection: three open invoices, PHP 311.12."""
    row = {
        "client_id": CLIENT,
        "client_name": "ZOHO FORM TEST ACCOUNT",
        "collection_amount": 311.12,
        "overdue_total": 311.12,
        "current_total": 0,
        "invoice_numbers": "TEst, test sampleee, ONGOING TEST",
        "branches_data": dumps(
            [
                {
                    "branch_name": "ZOHO FORM TEST ACCOUNT",
                    "sales_person": "DEXTER JAY CANCINO",
                    "collection_amount": 311.12,
                    "overdue_total": 311.12,
                    "current_total": 0,
                    "invoice_details": dumps(
                        [inv("TEst", 10), inv("test sampleee", 1.12), inv("ONGOING TEST", 300)]
                    ),
                }
            ]
        ),
        "excluded_invoices_data": "",
    }
    return {**row, **over}


def item(**over):
    return {"client_id": CLIENT, "client_name": "ZOHO FORM TEST ACCOUNT", "approved": True, **over}


def plan(items, rows=None, **kw):
    rows = {CLIENT: client_row()} if rows is None else rows
    return plan_approvals(items, rows, approved_by="Prince Kumar", at=AT, **kw)


def test_the_timestamp_looks_like_javascripts_toisostring():
    assert iso_z(datetime(2026, 11, 28, 11, 0, 0, 123456, tzinfo=UTC)) == "2026-11-28T11:00:00.123Z"


def test_approval_rows_are_kept_per_company_and_trimmed():
    rows = approval_rows(
        [
            item(client_name="N" * 300, note="x" * 600, allow_multibranch=True, excluded_invoices=["B", 7]),
            {
                "client_id": "ACME___a@b.co",
                "approved": False,
                "allow_multibranch": True,
                "excluded_invoices": ["1"],
            },
        ],
        "P" * 100,
        AT,
    )
    first, removed = rows
    assert first["company_key"] == "zoho form test account" and first["approved_by"] == "P" * 80
    assert len(first["client_name"]) == 200 and len(first["note"]) == 500
    assert first["allow_multibranch"] is True and first["excluded_invoices"] == '["B","7"]'
    # a removal never keeps multibranch or a selection
    assert (
        removed["company_key"] == "acme"
        and removed["allow_multibranch"] is False
        and removed["excluded_invoices"] == ""
    )


def test_unticking_one_invoice_sends_11_12_and_keeps_the_rest_for_later():
    p = plan([item(excluded_invoices=["ONGOING TEST"])])
    (update,) = p.selection_updates
    assert (
        update["collection_amount"] == 11.12
        and update["overdue_total"] == 11.12
        and update["current_total"] == 0
    )
    assert update["invoice_numbers"] == "TEst, test sampleee"
    saved = parse_json(update["excluded_invoices_data"], [])
    assert [e["invoice"]["invoice_number"] for e in saved] == ["ONGOING TEST"]
    assert (
        saved[0]["branch"]["sales_person"] == "DEXTER JAY CANCINO"
        and "invoice_details" not in saved[0]["branch"]
    )
    assert p.pdf_client_ids == [CLIENT] and p.skipped == []


def test_the_batch_keeps_the_full_balance_and_the_unticked_numbers():
    p = plan([item(excluded_invoices=["ONGOING TEST"])], source="dashboard")
    b = p.batch
    assert b["batch_id"] == f"{AT}|Prince Kumar" and b["client_count"] == 1 and b["source"] == "dashboard"
    assert b["balance_at_approval"] == 311.12 and b["overdue_at_approval"] == 311.12 and b["note"] == ""
    (c,) = parse_json(b["clients_json"], [])
    assert c["balance"] == 311.12 and c["excluded"] == ["ONGOING TEST"]
    assert c["invoices"] == [["TEst", 10, "O"], ["test sampleee", 1.12, "O"], ["ONGOING TEST", 300, "O"]]


def test_removing_the_approval_restores_every_invoice_and_makes_no_batch():
    after = plan([item(excluded_invoices=["ONGOING TEST"])]).selection_updates[0]
    rows = {CLIENT: client_row(**{k: v for k, v in after.items() if k != "client_id"})}
    p = plan([item(approved=False)], rows)
    (update,) = p.selection_updates
    assert update["collection_amount"] == 311.12 and update["excluded_invoices_data"] == ""
    assert update["invoice_numbers"] == "TEst, test sampleee, ONGOING TEST"
    assert p.batch is None and p.approval_rows[0]["approved"] is False


def test_changing_the_selection_starts_from_all_invoices_not_from_what_was_sent():
    first = plan([item(excluded_invoices=["ONGOING TEST"])]).selection_updates[0]
    rows = {CLIENT: client_row(**{k: v for k, v in first.items() if k != "client_id"})}
    second = plan([item(excluded_invoices=["TEst"])], rows)
    (update,) = second.selection_updates
    assert sorted(update["invoice_numbers"].split(", ")) == ["ONGOING TEST", "test sampleee"]
    assert update["collection_amount"] == 301.12
    # and the batch still shows the full balance
    assert second.batch["balance_at_approval"] == 311.12


def test_approving_without_a_list_changes_no_invoices_but_still_records_the_batch():
    p = plan([item()])
    assert p.selection_updates == [] and p.pdf_client_ids == []
    assert p.approval_rows[0]["excluded_invoices"] == "" and p.batch["client_count"] == 1


def test_an_empty_list_reapplies_everything_ticked():
    (update,) = plan([item(excluded_invoices=[])]).selection_updates
    assert update["collection_amount"] == 311.12 and update["excluded_invoices_data"] == ""


def test_a_client_is_never_left_without_an_invoice_and_unknown_clients_are_reported():
    p = plan(
        [
            item(excluded_invoices=["TEst", "test sampleee", "ONGOING TEST"]),
            {"client_id": "GHOST___x", "approved": True, "excluded_invoices": []},
        ]
    )
    assert p.selection_updates == []
    assert p.skipped == [
        {"client_id": CLIENT, "reason": "no invoice would remain"},
        {"client_id": "GHOST___x", "reason": "client row not found"},
    ]


def test_a_batch_totals_all_approved_clients_only():
    other = client_row(client_id="OTHER___y", client_name="OTHER", collection_amount=50, overdue_total=0, current_total=50,
                       branches_data=dumps([{"branch_name": "OTHER", "collection_amount": 50, "overdue_total": 0, "current_total": 50, "invoice_details": dumps([inv("9", 50, "CURRENT")])}]))  # fmt: skip
    rows = {CLIENT: client_row(), "OTHER___y": other}
    p = plan(
        [
            item(),
            {"client_id": "OTHER___y", "client_name": "OTHER", "approved": True},
            {"client_id": "REMOVED___z", "approved": False},
        ],
        rows,
    )
    assert p.batch["client_count"] == 2
    assert p.batch["balance_at_approval"] == 361.12 and p.batch["overdue_at_approval"] == 311.12
    invoices = parse_json(p.batch["clients_json"], [])[1]["invoices"]
    assert invoices == [["9", 50, "C"]]
