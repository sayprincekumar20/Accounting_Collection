"""Apply one approval action: record it here, mirror it to n8n's tables, ask n8n for the new statement PDFs."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app import audit
from app.domain.approvals import Plan, iso_z, plan_approvals
from app.domain.common import parse_json
from app.models import Approval, ApprovalBatch
from app.n8n_mirror import N8nHooks, N8nTables

WORKERS = 8


class MirrorError(RuntimeError):
    """The approval is saved in the backend but could not be written to n8n's tables."""

    def __init__(self, message: str, summary: dict[str, Any]) -> None:
        super().__init__(message)
        self.summary = summary


def fetch_client_rows(n8n: N8nTables, client_ids: list[str]) -> dict[str, dict[str, Any]]:
    unique = list(dict.fromkeys(client_ids))

    def one(client_id: str) -> tuple[str, list[dict[str, Any]]]:
        return client_id, n8n.get_rows("clients", "client_id", client_id)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        found = list(pool.map(one, unique))
    return {cid: rows[0] for cid, rows in found if rows}


def _summary(plan: Plan, actor: str, source: str, dry_run: bool) -> dict[str, Any]:
    return {
        "dry_run": dry_run,
        "source": source,
        "approved": sum(1 for r in plan.approval_rows if r["approved"]),
        "removed": sum(1 for r in plan.approval_rows if not r["approved"]),
        "batch_id": plan.batch["batch_id"] if plan.batch else None,
        "selection_updated": [u["client_id"] for u in plan.selection_updates],
        "skipped": plan.skipped,
    }


def _store_here(session: Session, plan: Plan) -> None:
    for row in plan.approval_rows:
        session.merge(
            Approval(
                company_key=row["company_key"],
                client_id=row["client_id"],
                client_name=row["client_name"],
                approved=row["approved"],
                approved_by=row["approved_by"],
                approved_at=datetime.fromisoformat(row["approved_at"].replace("Z", "+00:00")),
                note=row["note"],
                allow_multibranch=row["allow_multibranch"],
                excluded_invoices=parse_json(row["excluded_invoices"], []),
            )
        )
    if plan.batch:
        b = plan.batch
        session.merge(
            ApprovalBatch(
                batch_id=b["batch_id"],
                approved_at=datetime.fromisoformat(b["approved_at"].replace("Z", "+00:00")),
                approved_by=b["approved_by"],
                source=b["source"],
                client_count=b["client_count"],
                balance_at_approval=b["balance_at_approval"],
                overdue_at_approval=b["overdue_at_approval"],
                clients=parse_json(b["clients_json"], []),
                note=b["note"],
            )
        )


def _mirror(n8n: N8nTables, plan: Plan) -> None:
    """Write the same rows n8n's workflow 28 would have written."""
    latest = {r["company_key"]: r for r in plan.approval_rows}  # the last row of a company wins

    def upsert(row: dict[str, Any]) -> None:
        existing = n8n.get_rows("approvals", "company_key", row["company_key"])
        if existing:
            n8n.update(
                "approvals",
                "company_key",
                row["company_key"],
                {k: v for k, v in row.items() if k != "company_key"},
            )
        else:
            n8n.insert("approvals", [row])

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(upsert, latest.values()))
    if plan.batch:
        n8n.insert("approval_batches", [plan.batch])
    for update in plan.selection_updates:
        data = {k: v for k, v in update.items() if k != "client_id"}
        n8n.update("clients", "client_id", update["client_id"], data)


def apply_approvals(
    session: Session,
    n8n: N8nTables,
    hooks: N8nHooks,
    items: list[dict[str, Any]],
    *,
    actor: str,
    source: str = "dashboard",
    dry_run: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    at = iso_z(now or datetime.now(UTC))
    rows = fetch_client_rows(n8n, [i["client_id"] for i in items])
    plan = plan_approvals(items, rows, approved_by=actor, at=at, source=source)
    summary = _summary(plan, actor, source, dry_run)

    if dry_run:  # shadow mode: the plan is recorded, nothing is written anywhere
        audit.record(
            session,
            actor=actor,
            action="approvals.dry_run",
            subject_type="batch",
            subject_id=summary["batch_id"],
            detail=summary,
        )
        session.commit()
        return {"ok": True, "saved": len(items), "pdf_requested": 0, "warnings": [], **summary}

    _store_here(session, plan)
    audit.record(
        session,
        actor=actor,
        action="approvals.saved",
        subject_type="batch",
        subject_id=summary["batch_id"],
        detail=summary,
    )
    session.commit()

    try:
        _mirror(n8n, plan)
    except Exception as exc:
        audit.record(
            session,
            actor=actor,
            action="approvals.mirror_failed",
            subject_id=summary["batch_id"],
            detail={"error": str(exc)[:300]},
        )
        session.commit()
        raise MirrorError(f"saved here, but writing to n8n's tables failed: {exc}", summary) from exc

    warnings: list[str] = []
    requested = 0
    try:
        requested = hooks.regenerate_pdfs(plan.pdf_client_ids, actor)
    except Exception as exc:  # the approval itself is done; the PDF can be made again
        warnings.append(f"Statement PDFs were not started: {str(exc)[:200]}")
    return {"ok": True, "saved": len(items), "pdf_requested": requested, "warnings": warnings, **summary}
