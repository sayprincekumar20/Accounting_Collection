"""Document expiry overview for the dashboard: one row per document of each account's latest
verification, with days left, state and the reminders already sent. Reads only the database."""

from datetime import date

from sqlalchemy.orm import Session

from app.assessment.alerts import label
from app.db.models import Notification, Review
from app.notify.events import _latest_assessments

STATES = ("Expired", "Expiring in 7 days", "Expiring in 30 days", "Valid", "No expiry date")


def _state(days: int | None) -> str:
    if days is None:
        return "No expiry date"
    if days < 0:
        return "Expired"
    if days <= 7:
        return "Expiring in 7 days"
    if days <= 30:
        return "Expiring in 30 days"
    return "Valid"


def expiry_overview(db: Session, today: date) -> list[dict]:
    items = []
    for row, job in _latest_assessments(db):
        snap = job.account_snapshot or {}
        owner = snap.get("Owner") if isinstance(snap.get("Owner"), dict) else {}
        review = db.query(Review).filter_by(job_id=job.id).first()
        for r in row.assessment.get("requirements", []):
            if r["status"] not in ("VALID", "EXPIRED", "NO_EXPIRY"):
                continue
            until = r.get("valid_until")
            days = (date.fromisoformat(until) - today).days if until else None
            sent = []
            if until:
                prefix = f"{job.account_id}|{r['document_type']}|{until}|"
                sent = (db.query(Notification).filter(Notification.kind == "expiry",
                                                      Notification.ref.startswith(prefix))
                        .order_by(Notification.created_at.desc()).all())
            items.append({
                "account_id": job.account_id,
                "account_name": snap.get("Account_Name") or job.account_id,
                "customer_number": snap.get("Inventory_Customer_Number") or job.customer_number,
                "account_owner": owner.get("name"),
                "document_type": r["document_type"], "document": label(r["document_type"]),
                "file": r.get("file"), "valid_until": until, "days_left": days,
                "state": _state(days), "reminders_sent": len(sent),
                "last_reminder_at": sent[0].created_at.isoformat() if sent else None,
                "verified_at": row.created_at.isoformat() if row.created_at else None,
                "review_id": str(review.id) if review else None,
                "review_number": f"DV-{review.number}" if review else None,
            })
    items.sort(key=lambda i: (i["days_left"] is None, i["days_left"] or 0))
    return items
