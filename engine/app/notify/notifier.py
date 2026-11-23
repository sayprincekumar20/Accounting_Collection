"""One place that sends: Cliq message + Google Sheet rows; and remembers what was sent."""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.db.models import Notification
from app.notify.cliq import CliqClient
from app.notify.gmail import GmailClient
from app.notify.sheets import SheetsClient

log = logging.getLogger(__name__)
MANILA = ZoneInfo("Asia/Manila")

TABS = {
    "Verifications": ["Date/time (Manila)", "DV number", "Account", "Account ID", "Customer No.",
                      "Requested by", "Reason", "Recommendation", "Activation checks",
                      "Missing / not met", "Documents found", "Customer Status"],
    "Field Updates": ["Date/time (Manila)", "DV number", "Account", "Account ID", "Field",
                      "Old value", "New value", "Confidence", "How", "Result"],
    "Activations": ["Date/time (Manila)", "Account", "Account ID", "Customer No.", "Activated by",
                    "DV number"],
    "Document Expiry": ["Date/time (Manila)", "Account", "Account ID", "Customer No.", "Document",
                        "File", "Valid until", "Days left", "Alert level", "Status"],
}


def manila_now() -> str:
    return datetime.now(MANILA).strftime("%Y-%m-%d %H:%M")


class Notifier:
    def __init__(self, cliq: CliqClient | None, sheets: SheetsClient | None,
                 mailer: GmailClient | None = None, settings=None):
        self.cliq, self.sheets, self.mailer = cliq, sheets, mailer
        self.settings = settings
        self._tabs_ready = False

    @classmethod
    def from_settings(cls, settings) -> "Notifier":
        cliq = (CliqClient(settings.cliq_message_url, settings.cliq_webhook_token)
                if settings.cliq_message_url and settings.cliq_webhook_token else None)
        try:
            sheets = SheetsClient.from_settings(settings)
        except (OSError, ValueError) as exc:
            log.warning("Google Sheets log disabled: %s", exc)
            sheets = None
        mailer = GmailClient.from_settings(settings) if settings.notify_emails else None
        return cls(cliq, sheets, mailer, settings)

    @property
    def enabled(self) -> bool:
        return bool(self.cliq or self.sheets or self.mailer)

    def email(self, to: list[str], cc: list[str], subject: str, text: str,
              html: str | None = None) -> None:
        if self.mailer:
            self.mailer.send(to, cc, subject, text, html)

    def links(self, account_id: str, review_id: str | None = None) -> str:
        """Footer with links to the Account in Zoho and the review in the dashboard."""
        s, lines = self.settings, []
        if s is not None and s.zoho_crm_web_url:
            lines.append(f"Account in Zoho CRM: {s.zoho_crm_web_url.rstrip('/')}"
                         f"/tab/Accounts/{account_id}")
        if s is not None and s.dashboard_url and review_id:
            lines.append(f"Review: {s.dashboard_url.rstrip('/')}/verification/{review_id}")
        return "\n".join(lines)

    def message(self, text: str) -> None:
        if self.cliq:
            self.cliq.post(text)

    def rows(self, tab: str, rows: list[list]) -> None:
        if not self.sheets or not rows:
            return
        if not self._tabs_ready:
            try:
                self.sheets.ensure_tabs(TABS)
                self._tabs_ready = True
            except Exception as exc:  # noqa: BLE001 - logging must not break the caller
                log.warning("Google Sheet tabs could not be prepared: %s", exc)
                return
        self.sheets.append(tab, rows)


def already_sent(db: Session, kind: str, ref: str) -> bool:
    return db.query(Notification.id).filter_by(kind=kind, ref=ref[:300]).first() is not None


def mark_sent(db: Session, kind: str, ref: str, account_id: str | None,
              payload: dict | None = None) -> None:
    db.add(Notification(kind=kind, ref=ref[:300], account_id=account_id, payload=payload))
    db.flush()
