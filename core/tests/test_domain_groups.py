from app.domain.common import dumps
from app.domain.groups import build_items, count_groups, group_of

TODAY = "2026-11-26"


def client(name, *, overdue=0.0, current=0.0, parent="", branches="1", **extra):
    return {
        "client_id": f"{name}___x", "client_name": name, "parent_name": parent, "status": "ACTIVE",
        "collection_amount": overdue + current, "overdue_total": overdue, "current_total": current,
        "branch_customer_ids": branches, "sales_team": True, **extra,
    }  # fmt: skip


def groups(rows):
    return {i["client_name"]: group_of(i) for i in build_items(rows, TODAY)}


def test_the_four_groups():
    rows = [
        client("A", overdue=100),
        client("B", current=50),
        client("C", overdue=70, sales_team=False),
        client("D", overdue=70, internal_account=True, sales_team=False),
        *[client(f"HQ{i}", overdue=10, parent="BIG GROUP", branches=f"b{i}") for i in range(5)],
    ]
    g = groups(rows)
    assert g["A"] == "OVERDUE" and g["B"] == "CURRENT" and g["C"] == "OTHER" and g["D"] == "OTHER"
    assert all(g[f"HQ{i}"] == "MULTIBRANCH" for i in range(5))
    assert count_groups(build_items(rows, TODAY)) == {
        "OVERDUE": 1,
        "CURRENT": 1,
        "OTHER": 2,
        "MULTIBRANCH": 5,
    }


def test_four_branches_is_not_multibranch_five_is():
    four = [client(f"B{i}", overdue=1, parent="P4", branches=f"x{i}") for i in range(4)]
    assert set(groups(four).values()) == {"OVERDUE"}


def test_not_in_sales_team_wins_over_multibranch():
    rows = [
        client(f"B{i}", overdue=1, parent="P", branches=f"x{i}", sales_team=False if i == 0 else True)
        for i in range(5)
    ]
    g = groups(rows)
    assert g["B0"] == "OTHER" and g["B1"] == "MULTIBRANCH"


def test_retired_and_zero_balance_clients_are_not_listed():
    rows = [client("A", overdue=100), client("R", overdue=100, status="INACTIVE"), client("Z")]
    assert [i["client_name"] for i in build_items(rows, TODAY)] == ["A"]


def test_an_inactive_zoho_customer_with_a_balance_stays_in_its_overdue_group_and_is_still_reminded():
    rows = [client("WESTSIDE RESORT", overdue=500, customer_status="Inactive")]
    assert groups(rows) == {"WESTSIDE RESORT": "OVERDUE"}


def test_an_invoice_due_yesterday_moves_a_client_from_current_only_to_overdue_without_a_refresh():
    invoice = {
        "invoice_number": "1",
        "rule_due_date": "2026-11-25",
        "due_date": "2026-11-25",
        "balance": 931.0,
        "status": "CURRENT",
    }
    row = client(
        "C1",
        current=931.0,
        branches_data=dumps(
            [
                {
                    "branch_name": "C1",
                    "overdue_total": 0,
                    "current_total": 931.0,
                    "invoice_details": dumps([invoice]),
                }
            ]
        ),
    )
    assert groups([row]) == {"C1": "OVERDUE"}
