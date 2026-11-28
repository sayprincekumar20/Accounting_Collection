from app.tools.parity import compare


def row(name, overdue):
    return {
        "client_id": f"{name}___x", "client_name": name, "status": "ACTIVE", "collection_amount": overdue,
        "overdue_total": overdue, "current_total": 0, "branch_customer_ids": "1", "sales_team": True,
    }  # fmt: skip


def ts(name, group, overdue):
    return {
        "client_id": f"{name}___x",
        "group": group,
        "overdue": overdue,
        "current": 0,
        "total": overdue,
        "multibranch": False,
        "branch_count": 1,
    }


def test_identical_results_have_no_mismatches():
    report = compare([row("A", 10)], [ts("A", "OVERDUE", 10)], "2026-11-28")
    assert report["mismatches"] == [] and report["counts_python"] == report["counts_typescript"]


def test_differences_in_group_amount_or_presence_are_reported():
    report = compare(
        [row("A", 10), row("B", 5)], [ts("A", "CURRENT", 11), ts("C", "OVERDUE", 1)], "2026-11-28"
    )
    by = {m["client_id"]: m for m in report["mismatches"]}
    assert by["A___x"]["diffs"] == {
        "group": ["OVERDUE", "CURRENT"],
        "overdue": [10.0, 11],
        "total": [10.0, 11],
    }
    assert by["B___x"]["problem"] == "only in typescript" or by["B___x"]["problem"] == "only in python"
    assert "C___x" in by
