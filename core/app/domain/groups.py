"""The client groups of Contact Approvals, defined once so every page and every sender uses the same rules:

- OVERDUE        Sales Team clients with fewer than 5 branches and an overdue amount
- CURRENT        the same clients with nothing overdue (only current invoices)
- OTHER          owner not in the Sales Team, and internal Rare accounts: never contacted
- MULTIBRANCH    5 or more branches: not contacted unless AR explicitly approves (Approve and contact now)

Customer status (Active / Inactive in Zoho CRM) is NOT a group: an Inactive customer with an open balance is still
reminded. Port of dashboard/src/lib/approvals-data.ts and the tabs of routes/approvals.tsx.
"""

from typing import Any, Literal

from app.domain.common import num, s
from app.domain.invoice_selection import with_selection_restored
from app.domain.live_status import with_live_status

MIN_BRANCHES = 5
Group = Literal["OVERDUE", "CURRENT", "OTHER", "MULTIBRANCH"]


def company_key(client_id: Any) -> str:
    """Approvals are kept per company: the part of client_id before '___'."""
    return s(client_id).split("___")[0].strip().lower()


def parent_key(row: dict[str, Any]) -> str:
    return s(row.get("parent_name") or row.get("client_name")).strip().lower()


def is_retired(row: dict[str, Any]) -> bool:
    """n8n's `status` column: INACTIVE = retired (no open balance any more). Not the Zoho Customer Status."""
    return s(row.get("status")).upper() == "INACTIVE"


def _tri_state(value: Any) -> bool | None:
    if value is False or s(value) == "false":
        return False
    if value is True or s(value) == "true":
        return True
    return None


def prepare(row: dict[str, Any], today: str) -> dict[str, Any]:
    """Display view of a client row as the dashboard loads it: unticked invoices back in, status as of today."""
    return with_live_status(with_selection_restored(row), today)


def build_items(rows: list[dict[str, Any]], today: str) -> list[dict[str, Any]]:
    """Every client with an open balance, with the fields the groups depend on."""
    prepared = [prepare(r, today) for r in rows]
    branches_by_parent: dict[str, set[str]] = {}
    for c in prepared:
        if is_retired(c):
            continue
        ids = branches_by_parent.setdefault(parent_key(c), set())
        for branch_id in s(c.get("branch_customer_ids")).split(","):
            if branch_id.strip():
                ids.add(branch_id.strip())
    items = []
    for c in prepared:
        if is_retired(c) or not num(c.get("collection_amount")) > 0:
            continue
        count = len(branches_by_parent.get(parent_key(c), ()))
        items.append(
            {
                "client_id": s(c.get("client_id")),
                "client_name": s(c.get("client_name")),
                "parent_name": s(c.get("parent_name")),
                "overdue": num(c.get("overdue_total")),
                "current": num(c.get("current_total")),
                "total": num(c.get("collection_amount")),
                "sales_team": _tri_state(c.get("sales_team")),
                "internal_account": c.get("internal_account") is True
                or s(c.get("internal_account")) == "true",
                "branch_count": count,
                "multibranch": count >= MIN_BRANCHES,
            }
        )
    return items


def group_of(item: dict[str, Any]) -> Group:
    if item["sales_team"] is False:
        return "OTHER"
    if item["multibranch"]:
        return "MULTIBRANCH"
    return "OVERDUE" if item["overdue"] > 0 else "CURRENT"


def count_groups(items: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"OVERDUE": 0, "CURRENT": 0, "OTHER": 0, "MULTIBRANCH": 0}
    for item in items:
        counts[group_of(item)] += 1
    return counts
