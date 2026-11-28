"""Invoice selection (Contact Approvals): unticked invoices are not sent this cycle.

Two views of the same data, identical to what n8n (workflows 28 and 00) and the dashboard do today:
- SENT view: unticked invoices are moved out of `branches_data` into `excluded_invoices_data`, so everything that
  sends (statement, texts, email, calls, AI replies) uses only the ticked invoices.
- DISPLAY view: the unticked invoices are put back (marked `excluded`) so the dashboard shows the real balance.
Port of dashboard/src/lib/invoice-selection.ts and the sel* functions of the n8n workflows.
"""

from typing import Any

from app.domain.common import dumps, num, parse_json, r2, s


def _is_overdue(inv: dict[str, Any]) -> bool:
    return s(inv.get("status")).upper() == "OVERDUE"


def _branch_totals(branch: dict[str, Any], invoices: list[dict[str, Any]]) -> dict[str, Any]:
    over = sum(num(i.get("balance")) for i in invoices if _is_overdue(i))
    cur = sum(num(i.get("balance")) for i in invoices if not _is_overdue(i))
    return {
        **branch,
        "invoice_details": dumps(invoices),
        "invoice_numbers": ", ".join(s(i.get("invoice_number")) for i in invoices if i.get("invoice_number")),
        "overdue_total": r2(over),
        "current_total": r2(cur),
        "collection_amount": r2(over + cur),
    }


def restore(branches: list[dict[str, Any]], excluded: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """All invoices back in their branches (full data), recalculated."""
    work = [{**b, "_inv": parse_json(b.get("invoice_details"), [])} for b in branches]
    for entry in excluded or []:
        invoice = (entry or {}).get("invoice")
        if not invoice:
            continue
        shell = entry.get("branch") or {}
        target = next((b for b in work if s(b.get("branch_name")) == s(shell.get("branch_name"))), None)
        if target is None:
            target = {**shell, "_inv": []}
            work.append(target)
        if not any(s(i.get("invoice_number")) == s(invoice.get("invoice_number")) for i in target["_inv"]):
            target["_inv"].append(invoice)
    out = []
    for b in work:
        invs = b.pop("_inv")
        out.append(_branch_totals(b, invs))
    return out


def apply_selection(
    full_branches: list[dict[str, Any]], excluded_numbers: list[str]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Full branches plus the unticked invoice numbers give (sent branches, excluded entries, sent totals)."""
    unticked = {s(n) for n in excluded_numbers or []}
    kept: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for b in full_branches:
        invoices = parse_json(b.get("invoice_details"), [])
        shell = {k: v for k, v in b.items() if k != "invoice_details"}
        keep = []
        for inv in invoices:
            if s(inv.get("invoice_number")) in unticked:
                excluded.append({"branch": shell, "invoice": inv})
            else:
                keep.append(inv)
        if keep:
            kept.append(_branch_totals(b, keep))
    over = r2(sum(num(b.get("overdue_total")) for b in kept))
    cur = r2(sum(num(b.get("current_total")) for b in kept))
    totals = {
        "collection_amount": r2(over + cur),
        "overdue_total": over,
        "current_total": cur,
        "invoice_numbers": ", ".join(s(b.get("invoice_numbers")) for b in kept if b.get("invoice_numbers")),
    }
    return kept, excluded, totals


def with_selection_restored(row: dict[str, Any]) -> dict[str, Any]:
    """DISPLAY view of a client row: full balance, unticked invoices marked, and `selection` = what is sent."""
    excluded = [
        e
        for e in parse_json(row.get("excluded_invoices_data"), [])
        if isinstance(e, dict) and e.get("invoice")
    ]
    if not excluded:
        return row
    branches = [
        {**b, "_inv": parse_json(b.get("invoice_details"), [])}
        for b in parse_json(row.get("branches_data"), [])
    ]
    sent_count = sum(len(b["_inv"]) for b in branches)
    for entry in excluded:
        shell = entry.get("branch") or {}
        name = s(shell.get("branch_name"))
        target = next((b for b in branches if s(b.get("branch_name")) == name), None)
        if target is None:
            target = {**shell, "_inv": []}
            branches.append(target)
        number = s(entry["invoice"].get("invoice_number"))
        if not any(s(i.get("invoice_number")) == number for i in target["_inv"]):
            target["_inv"].append({**entry["invoice"], "excluded": True})
    over = 0.0
    cur = 0.0
    full = []
    for b in branches:
        invs = b.pop("_inv")
        bo = sum(num(i.get("balance")) for i in invs if _is_overdue(i))
        bc = sum(num(i.get("balance")) for i in invs if not _is_overdue(i))
        over += bo
        cur += bc
        full.append(
            {
                **b,
                "invoice_details": dumps(invs),
                "invoice_numbers": ", ".join(
                    s(i.get("invoice_number")) for i in invs if s(i.get("invoice_number"))
                ),
                "overdue_total": r2(bo),
                "current_total": r2(bc),
                "collection_amount": r2(bo + bc),
            }
        )
    selection = {
        "excluded": [
            s(e["invoice"].get("invoice_number")) for e in excluded if s(e["invoice"].get("invoice_number"))
        ],
        "sent_amount": num(row.get("collection_amount")),
        "sent_overdue": num(row.get("overdue_total")),
        "selected_count": sent_count,
        "total_count": sent_count + len(excluded),
    }
    return {
        **row,
        "branches_data": dumps(full),
        "collection_amount": r2(over + cur),
        "overdue_total": r2(over),
        "current_total": r2(cur),
        "invoice_numbers": ", ".join(b["invoice_numbers"] for b in full if b["invoice_numbers"]),
        "selection": selection,
    }


def sent_view(row: dict[str, Any]) -> dict[str, Any]:
    """Amounts and invoice statuses of what is SENT (ticked invoices only), from a display-view row."""
    overdue = 0.0
    current = 0.0
    statuses: list[str] = []
    for b in parse_json(row.get("branches_data"), []):
        for inv in parse_json(b.get("invoice_details"), []):
            if inv.get("excluded") is True:
                continue
            bal = num(inv.get("balance"))
            if not bal > 0:
                continue
            status = s(inv.get("status")).upper()
            statuses.append(status)
            if status == "OVERDUE":
                overdue += bal
            else:
                current += bal
    return {
        "overdue": r2(overdue),
        "current": r2(current),
        "total": r2(overdue + current),
        "statuses": statuses,
    }
