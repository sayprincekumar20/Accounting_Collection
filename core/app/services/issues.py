"""Escalation status and issue history: record them here and write the same rows into n8n's tables.

For the status of an escalation n8n's table stays the system of record until the workflows that create escalations
move (waves 3 and 4), so the row is updated there; the change is also written to the audit log. History lines are
stored here (issue_events) and mirrored into n8n's issue_log table, where the dashboard still reads them.
Nothing in this module sends a message or places a call.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app import audit
from app.domain.approvals import iso_z
from app.domain.issues import history_row, status_update_data
from app.models import IssueEvent
from app.n8n_mirror import N8nTables
from app.services.approvals import MirrorError


def update_status(
    session: Session,
    n8n: N8nTables,
    *,
    entry_id: str,
    status: str,
    note: str,
    actor: str,
    dry_run: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    rows = n8n.get_rows("escalations", "entry_id", entry_id)
    data = status_update_data(status, actor, note, now)
    detail = {
        "entry_id": entry_id,
        "from": (rows[0].get("status") if rows else None),
        "to": data["status"],
        "note": data["ar_note"],
        "updated": len(rows),
        "dry_run": dry_run,
    }
    if dry_run:
        audit.record(
            session,
            actor=actor,
            action="escalation.status_dry_run",
            subject_type="escalation",
            subject_id=entry_id,
            detail=detail,
        )
        session.commit()
        return {"ok": True, "updated": len(rows), "dry_run": True}
    if rows:
        n8n.update("escalations", "entry_id", entry_id, data)
    audit.record(
        session,
        actor=actor,
        action="escalation.status",
        subject_type="escalation",
        subject_id=entry_id,
        detail=detail,
    )
    session.commit()
    return {"ok": True, "updated": len(rows), "dry_run": False}


def record_event(
    session: Session,
    n8n: N8nTables,
    *,
    issue_id: str,
    issue_kind: str,
    ref: str,
    event: str,
    summary: str,
    detail: Any,
    event_actor: str,
    acting_user: str,
    dry_run: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    at = iso_z(now)
    row = history_row(
        issue_id=issue_id, issue_kind=issue_kind, ref=ref, event=event, summary=summary, detail=detail,
        actor=event_actor or acting_user, at=at,
    )  # fmt: skip
    if dry_run:
        audit.record(
            session,
            actor=acting_user,
            action="issue.event_dry_run",
            subject_type="issue",
            subject_id=row["issue_id"],
            detail={"event": row["event"], "dry_run": True},
        )
        session.commit()
        return {"ok": True, "dry_run": True}
    session.add(
        IssueEvent(
            issue_id=row["issue_id"], issue_kind=row["issue_kind"], ref=row["ref"], event=row["event"],
            summary=row["summary"], detail=row["detail"], actor=row["actor"], at=now,
        )
    )  # fmt: skip
    session.commit()
    try:
        n8n.insert("issue_log", [row])
    except Exception as exc:
        audit.record(
            session,
            actor=acting_user,
            action="issue.event_mirror_failed",
            subject_type="issue",
            subject_id=row["issue_id"],
            detail={"error": str(exc)[:300]},
        )
        session.commit()
        raise MirrorError(
            f"saved here, but writing to n8n's tables failed: {exc}", {"batch_id": None}
        ) from exc
    return {"ok": True, "dry_run": False}
