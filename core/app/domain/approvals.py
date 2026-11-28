"""What one approval action does, as a pure plan (no database, no network).

Port of n8n workflow 28_Contact_Approval_Update:
- one approval row per company (the part of client_id before '___'), so approvals survive a contact change;
- one batch per action (the clients approved in it; removals are not a batch), with each client's balance and open
  invoices at that moment, so the batch report can show what was collected since;
- the invoice selection: unticked invoices are moved out of the client's `branches_data` into
  `excluded_invoices_data`, or all invoices are restored when an approval is removed.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.domain.common import dumps, num, parse_json, r2, s
from app.domain.invoice_selection import apply_selection, restore

MAX_ITEMS = 500


def iso_z(moment: datetime) -> str:
    """JavaScript's new Date().toISOString(): UTC with milliseconds and a Z."""
    utc = moment.astimezone(UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def company_key(client_id: str) -> str:
    return s(client_id).split("___")[0].strip().lower()


@dataclass
class Plan:
    approval_rows: list[dict[str, Any]] = field(default_factory=list)
    batch: dict[str, Any] | None = None
    selection_updates: list[dict[str, Any]] = field(default_factory=list)
    skipped: list[dict[str, str]] = field(default_factory=list)

    @property
    def pdf_client_ids(self) -> list[str]:
        """Clients whose statement PDF must be made again (their invoices changed)."""
        return [u["client_id"] for u in self.selection_updates]


def approval_rows(items: list[dict[str, Any]], approved_by: str, at: str) -> list[dict[str, Any]]:
    rows = []
    for item in items:
        approved = bool(item.get("approved"))
        excluded = item.get("excluded_invoices")
        rows.append(
            {
                "company_key": company_key(item["client_id"]),
                "client_id": s(item["client_id"]),
                "client_name": s(item.get("client_name"))[:200],
                "approved": approved,
                "approved_by": s(approved_by)[:80],
                "approved_at": at,
                "note": s(item.get("note"))[:500],
                "allow_multibranch": approved and bool(item.get("allow_multibranch")),
                "excluded_invoices": dumps([s(x) for x in excluded])
                if approved and isinstance(excluded, list)
                else "",
            }
        )
    return rows


def _selection_requests(items: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Clients whose selection must be (re)applied: approved with a list of unticked invoices, or approval removed."""
    wanted: dict[str, list[str]] = {}
    for item in items:
        if isinstance(item.get("excluded_invoices"), list) or item.get("approved") is False:
            ticked_off = [s(x) for x in (item.get("excluded_invoices") or []) if s(x)]
            wanted[s(item["client_id"])] = ticked_off if item.get("approved") else []
    return wanted


def _open_invoices(row: dict[str, Any]) -> tuple[list[list[Any]], float, float]:
    """All open invoices of a client (also those unticked earlier), as [number, balance, 'O'|'C'], plus totals."""
    invoices: list[list[Any]] = []
    total = 0.0
    overdue = 0.0
    for branch in restore(
        parse_json(row.get("branches_data"), []), parse_json(row.get("excluded_invoices_data"), [])
    ):
        for inv in parse_json(branch.get("invoice_details"), []):
            balance = num(inv.get("balance"))
            if balance > 0:
                status = "C" if s(inv.get("status")).upper() == "CURRENT" else "O"
                invoices.append([s(inv.get("invoice_number")), r2(balance), status])
        total += num(branch.get("collection_amount"))
        overdue += num(branch.get("overdue_total"))
    return invoices, total, overdue


def build_batch(
    items: list[dict[str, Any]], rows_by_id: dict[str, dict[str, Any]], approved_by: str, at: str, source: str
) -> dict[str, Any] | None:
    approved = [i for i in items if bool(i.get("approved"))]
    if not approved:
        return None
    clients = []
    balance = 0.0
    overdue = 0.0
    for item in approved:
        client_id = s(item["client_id"])
        row = rows_by_id.get(client_id) or {}
        invoices, total, over = _open_invoices(row)
        balance += total
        overdue += over
        excluded = item.get("excluded_invoices")
        clients.append(
            {
                "client_id": client_id,
                "client_name": s(item.get("client_name"))[:200] or s(row.get("client_name")),
                "balance": r2(total),
                "overdue": r2(over),
                "invoices": invoices,
                "excluded": [s(x) for x in excluded] if isinstance(excluded, list) else [],
            }
        )
    return {
        "batch_id": f"{at}|{s(approved_by)[:80]}",
        "approved_at": at,
        "approved_by": s(approved_by)[:80],
        "source": s(source)[:40] or "dashboard",
        "client_count": len(clients),
        "balance_at_approval": r2(balance),
        "overdue_at_approval": r2(overdue),
        "clients_json": dumps(clients),
        "note": "",
    }


def plan_approvals(
    items: list[dict[str, Any]],
    rows_by_id: dict[str, dict[str, Any]],
    *,
    approved_by: str,
    at: str,
    source: str = "dashboard",
) -> Plan:
    plan = Plan(approval_rows=approval_rows(items, approved_by, at))
    plan.batch = build_batch(items, rows_by_id, approved_by, at, source)
    for client_id, excluded in _selection_requests(items).items():
        row = rows_by_id.get(client_id)
        if not row:
            plan.skipped.append({"client_id": client_id, "reason": "client row not found"})
            continue
        full = restore(
            parse_json(row.get("branches_data"), []), parse_json(row.get("excluded_invoices_data"), [])
        )
        kept, excluded_entries, totals = apply_selection(full, excluded)
        if not kept:  # never leave a client without an invoice
            plan.skipped.append({"client_id": client_id, "reason": "no invoice would remain"})
            continue
        plan.selection_updates.append(
            {
                "client_id": client_id,
                "branches_data": dumps(kept),
                "excluded_invoices_data": dumps(excluded_entries) if excluded_entries else "",
                **totals,
            }
        )
    return plan
