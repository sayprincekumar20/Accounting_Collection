from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.domain.cycle import cycle_start, manila_today
from app.domain.groups import build_items, count_groups
from app.models import N8nRow
from app.security import require_service

router = APIRouter(prefix="/v1", tags=["groups"], dependencies=[Depends(require_service)])


@router.get("/groups/summary")
def groups_summary(session: Session = Depends(get_session)) -> dict[str, Any]:
    """Counts of the four client groups from the landed n8n clients table (read-only; parity check with the dashboard)."""
    rows = [r.data for r in session.scalars(select(N8nRow).where(N8nRow.table_name == "clients"))]
    last = session.scalar(select(func.max(N8nRow.imported_at)).where(N8nRow.table_name == "clients"))
    today = manila_today()
    counts = count_groups(build_items(rows, today))
    return {
        "as_of": today,
        "cycle_start": cycle_start().isoformat(),
        "clients_landed": len(rows),
        "last_import_at": last.isoformat() if last else None,
        "counts": {
            "overdue": counts["OVERDUE"],
            "current_only": counts["CURRENT"],
            "other_accounts": counts["OTHER"],
            "multibranch_5plus": counts["MULTIBRANCH"],
        },
    }
