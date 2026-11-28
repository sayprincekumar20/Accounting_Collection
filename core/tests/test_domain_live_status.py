from datetime import UTC, datetime

from app.domain.common import dumps, parse_json
from app.domain.cycle import cycle_start, manila_today
from app.domain.live_status import with_live_status


def inv(number, due, bal, status):
    return {
        "invoice_number": number,
        "rule_due_date": due,
        "due_date": due,
        "balance": bal,
        "amount": bal,
        "status": status,
    }


def gw_mart():
    return {
        "client_id": "GW MART___willdrey_ang@yahoo.com",
        "collection_amount": 4866778.98,
        "overdue_total": 3935314.17,
        "current_total": 931464.81,
        "branches_data": dumps(
            [
                {
                    "branch_name": "Gw Mart",
                    "collection_amount": 4866778.98,
                    "overdue_total": 3935314.17,
                    "current_total": 931464.81,
                    "invoice_details": dumps(
                        [
                            inv("33198", "2026-11-25", 931464.81, "CURRENT"),
                            inv("33177", "2026-11-24", 3935314.17, "OVERDUE"),
                        ]
                    ),
                }
            ]
        ),
    }


def test_invoice_due_yesterday_is_overdue_today_and_the_amount_owed_does_not_change():
    r = with_live_status(gw_mart(), "2026-11-26")
    assert r["overdue_total"] == 4866778.98
    assert r["current_total"] == 0
    assert r["collection_amount"] == 4866778.98
    branch = parse_json(r["branches_data"], [])[0]
    assert branch["overdue_total"] == 4866778.98
    statuses = [i["status"] for i in parse_json(branch["invoice_details"], [])]
    assert statuses == ["OVERDUE", "OVERDUE"]


def test_on_its_due_date_it_is_still_current():
    row = gw_mart()
    assert with_live_status(row, "2026-11-25") is row


def test_input_is_not_modified_and_rows_without_current_invoices_are_returned_as_they_are():
    row = gw_mart()
    with_live_status(row, "2026-11-26")
    assert row["overdue_total"] == 3935314.17
    all_overdue = {
        **row,
        "branches_data": dumps([{"invoice_details": dumps([inv("1", "2026-11-01", 5, "OVERDUE")])}]),
    }
    assert with_live_status(all_overdue, "2026-11-26") is all_overdue


def test_manila_day_and_cycle_start():
    assert manila_today(datetime(2026, 11, 25, 16, 30, tzinfo=UTC)) == "2026-11-26"
    assert manila_today(datetime(2026, 11, 25, 15, 30, tzinfo=UTC)) == "2026-11-25"
    # Wednesday Nov 25 04:00 Manila -> that Wednesday 00:00 Manila = Nov 24 16:00 UTC
    assert cycle_start(datetime(2026, 11, 24, 20, 0, tzinfo=UTC)) == datetime(2026, 11, 24, 16, 0, tzinfo=UTC)
    # Tuesday 23:59 Manila still belongs to the previous cycle
    assert cycle_start(datetime(2026, 11, 24, 15, 59, 59, tzinfo=UTC)) == datetime(
        2026, 11, 17, 16, 0, tzinfo=UTC
    )
    # Sunday Nov 29 Manila -> still the cycle that began Wednesday Nov 25
    assert cycle_start(datetime(2026, 11, 29, 3, 0, tzinfo=UTC)) == datetime(2026, 11, 24, 16, 0, tzinfo=UTC)
