"""Escalation status and issue history, as pure functions.

Port of n8n workflow 27_Worklist_Update (the status of an escalation or system notification, who handled it, when,
the note) and 33_Issue_Log (one history line per diagnosis, action, status change or resolution).
Nothing here sends anything: these are changes to records only.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from app.domain.common import dumps, s

MANILA_TZ = timezone(timedelta(hours=8))
STATUSES = ("OPEN", "IN_PROGRESS", "DONE")
EVENTS = ("DIAGNOSIS", "ACTION", "STATUS", "RESOLUTION", "NOTE")
KINDS = ("ESCALATION", "SYSTEM")


def manila_iso(now: datetime) -> str:
    """Luxon's toISO() in the workflow's Manila time zone: 2026-11-28T23:30:00.123+08:00."""
    return now.astimezone(MANILA_TZ).isoformat(timespec="milliseconds")


def status_update_data(status: str, handled_by: str, note: str, now: datetime) -> dict[str, Any]:
    """The columns workflow 27 writes on the escalation row."""
    return {
        "status": s(status).upper(),
        "handled_by": s(handled_by)[:80],
        "handled_at": manila_iso(now),
        "ar_note": s(note)[:500],
    }


def history_row(
    *,
    issue_id: str,
    issue_kind: str,
    ref: str,
    event: str,
    summary: str,
    detail: Any,
    actor: str,
    at: str,
) -> dict[str, Any]:
    """The row workflow 33 writes in the issue_log table (same truncations)."""
    text = detail if isinstance(detail, str) else (dumps(detail) if detail not in (None, "") else "")
    return {
        "issue_id": s(issue_id)[:200],
        "issue_kind": s(issue_kind).upper(),
        "ref": s(ref)[:80],
        "event": s(event).upper(),
        "summary": s(summary)[:1000],
        "detail": text[:8000],
        "actor": s(actor)[:80],
        "timestamp": at,
    }
