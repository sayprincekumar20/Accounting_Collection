"""Overdue status as of TODAY (Manila), not as of the last Zoho refresh.

n8n sets each invoice's status when it refreshes a client, so an invoice due on Thursday stayed CURRENT until the
next refresh and every page understated the overdue amount. An invoice is OVERDUE once its due date has passed and
never goes back. Only statuses and the overdue/current totals change, never the amount owed (collection_amount).
Port of dashboard/src/lib/live-status.ts.
"""

import re
from typing import Any

from app.domain.common import dumps, num, parse_json, r2, s

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def with_live_status(row: dict[str, Any], today: str) -> dict[str, Any]:
    """The client row with statuses and totals as of `today` (YYYY-MM-DD, Manila); the input is never modified."""
    raw = row.get("branches_data")
    if not isinstance(raw, str) or "CURRENT" not in raw:
        return row
    branches = parse_json(raw, None)
    if not isinstance(branches, list):
        return row
    changed = False
    overdue = 0.0
    current = 0.0
    for branch in branches:
        invoices = parse_json(
            s(branch.get("invoice_details") if branch.get("invoice_details") is not None else "[]"), None
        )
        if not isinstance(invoices, list):
            overdue += num(branch.get("overdue_total"))
            current += num(branch.get("current_total"))
            continue
        b_over = 0.0
        b_cur = 0.0
        b_changed = False
        for inv in invoices:
            due = s(inv.get("rule_due_date") or inv.get("due_date"))[:10]
            if s(inv.get("status")).upper() == "CURRENT" and _DATE.match(due) and due < today:
                inv["status"] = "OVERDUE"
                b_changed = True
            bal = num(inv.get("balance"))
            if s(inv.get("status")).upper() == "OVERDUE":
                b_over += bal
            else:
                b_cur += bal
        if b_changed:
            changed = True
            branch["invoice_details"] = dumps(invoices)
            branch["overdue_total"] = r2(b_over)
            branch["current_total"] = r2(b_cur)
            overdue += b_over
            current += b_cur
        else:
            overdue += num(branch.get("overdue_total"))
            current += num(branch.get("current_total"))
    if not changed:
        return row
    return {
        **row,
        "branches_data": dumps(branches),
        "overdue_total": r2(overdue),
        "current_total": r2(current),
    }
