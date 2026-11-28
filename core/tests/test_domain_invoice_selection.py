from app.domain.common import dumps, parse_json
from app.domain.invoice_selection import apply_selection, restore, sent_view, with_selection_restored


def inv(number, bal, status="OVERDUE"):
    return {"invoice_number": number, "balance": bal, "amount": bal, "status": status}


# The row n8n really wrote in the Nov 26 test: "ONGOING TEST" (300) unticked, 11.12 sent.
TEST_ROW = {
    "client_id": "ZOHO FORM TEST ACCOUNT___pk8543264@gmail.com",
    "collection_amount": 11.12,
    "overdue_total": 11.12,
    "current_total": 0,
    "invoice_numbers": "TEst, test sampleee",
    "branches_data": dumps(
        [
            {
                "branch_name": "ZOHO FORM TEST ACCOUNT",
                "collection_amount": 11.12,
                "overdue_total": 11.12,
                "current_total": 0,
                "invoice_details": dumps([inv("TEst", 10), inv("test sampleee", 1.12)]),
            }
        ]
    ),
    "excluded_invoices_data": dumps(
        [
            {
                "branch": {"branch_name": "ZOHO FORM TEST ACCOUNT", "sales_person": "DEXTER JAY CANCINO"},
                "invoice": inv("ONGOING TEST", 300),
            }
        ]
    ),
}


def test_display_view_shows_the_full_balance_and_marks_the_unticked_invoice():
    r = with_selection_restored(TEST_ROW)
    assert r["collection_amount"] == 311.12
    assert r["overdue_total"] == 311.12
    assert r["selection"] == {
        "excluded": ["ONGOING TEST"], "sent_amount": 11.12, "sent_overdue": 11.12, "selected_count": 2, "total_count": 3,
    }  # fmt: skip
    invoices = parse_json(parse_json(r["branches_data"], [])[0]["invoice_details"], [])
    assert [(i["invoice_number"], bool(i.get("excluded"))) for i in invoices] == [
        ("TEst", False), ("test sampleee", False), ("ONGOING TEST", True),
    ]  # fmt: skip


def test_a_branch_with_all_invoices_unticked_comes_back_too():
    row = {
        **TEST_ROW,
        "excluded_invoices_data": dumps([{"branch": {"branch_name": "Annex"}, "invoice": inv("9", 50)}]),
    }
    r = with_selection_restored(row)
    assert [b["branch_name"] for b in parse_json(r["branches_data"], [])] == [
        "ZOHO FORM TEST ACCOUNT",
        "Annex",
    ]
    assert r["collection_amount"] == 61.12


def test_rows_without_a_selection_are_returned_as_they_are():
    plain = {**TEST_ROW, "excluded_invoices_data": ""}
    assert with_selection_restored(plain) is plain


def test_sent_view_counts_ticked_invoices_only():
    assert sent_view(with_selection_restored(TEST_ROW)) == {
        "overdue": 11.12, "current": 0, "total": 11.12, "statuses": ["OVERDUE", "OVERDUE"],
    }  # fmt: skip


FULL = [
    {
        "branch_name": "Main",
        "sales_person": "Sam",
        "invoice_details": dumps([inv("1", 200), inv("2", 300), inv("3", 100, "CURRENT")]),
    },
    {"branch_name": "Annex", "sales_person": "Sam", "invoice_details": dumps([inv("9", 50)])},
]


def test_nothing_unticked_keeps_everything():
    _, excluded, totals = apply_selection(FULL, [])
    assert excluded == []
    assert totals == {
        "collection_amount": 650,
        "overdue_total": 550,
        "current_total": 100,
        "invoice_numbers": "1, 2, 3, 9",
    }


def test_unticking_an_invoice_and_a_whole_branch():
    kept, excluded, totals = apply_selection(FULL, ["2", "9"])
    assert totals == {
        "collection_amount": 300,
        "overdue_total": 200,
        "current_total": 100,
        "invoice_numbers": "1, 3",
    }
    assert len(kept) == 1 and kept[0]["invoice_numbers"] == "1, 3" and kept[0]["sales_person"] == "Sam"
    assert [e["invoice"]["invoice_number"] for e in excluded] == ["2", "9"]
    assert excluded[1]["branch"]["branch_name"] == "Annex" and "invoice_details" not in excluded[1]["branch"]


def test_restore_then_apply_a_new_selection_and_new_invoices_midweek_are_included():
    kept, excluded, _ = apply_selection(FULL, ["2", "9"])
    back = restore(kept, excluded)
    assert sum(b["collection_amount"] for b in back) == 650
    assert [b["branch_name"] for b in back] == ["Main", "Annex"]
    _, _, totals = apply_selection(back, ["1"])
    assert (
        sorted(totals["invoice_numbers"].split(", ")) == ["2", "3", "9"]
        and totals["collection_amount"] == 450
    )
    # a refresh brings NEW invoice 4: only the stored numbers stay excluded, so 4 is included
    refreshed = [
        {
            **FULL[0],
            "invoice_details": dumps(
                [inv("1", 200), inv("2", 300), inv("3", 100, "CURRENT"), inv("4", 70, "CURRENT")]
            ),
        }
    ]
    _, excl, totals = apply_selection(refreshed, ["2", "9"])
    assert totals["invoice_numbers"] == "1, 3, 4" and len(excl) == 1  # 9 was paid: gone from the fresh data
