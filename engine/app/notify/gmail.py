"""Send emails through the company Gmail mailbox (the same account the dashboard uses).

Settings: GMAIL_BUSINESS_EMAIL, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
(the refresh token needs the gmail.send scope). Never raises: a failed email must not break
a verification or a review decision.
"""

import base64
import logging
import time
from email.message import EmailMessage
from email.utils import formataddr

import httpx

log = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"


class GmailClient:
    def __init__(self, sender: str, client_id: str, client_secret: str, refresh_token: str,
                 http: httpx.Client | None = None, sender_name: str = "Rare Global Food"):
        self.sender, self.sender_name = sender, sender_name
        self.client_id, self.client_secret, self.refresh_token = (
            client_id, client_secret, refresh_token)
        self.http = http or httpx.Client(timeout=30)
        self._token: tuple[str, float] | None = None

    @classmethod
    def from_settings(cls, settings) -> "GmailClient | None":
        if not (settings.gmail_business_email and settings.gmail_client_id
                and settings.gmail_client_secret and settings.gmail_refresh_token):
            return None
        return cls(settings.gmail_business_email, settings.gmail_client_id,
                   settings.gmail_client_secret, settings.gmail_refresh_token)

    def _access_token(self) -> str:
        if self._token and self._token[1] > time.time() + 60:
            return self._token[0]
        r = self.http.post(TOKEN_URL, data={
            "client_id": self.client_id, "client_secret": self.client_secret,
            "refresh_token": self.refresh_token.strip(), "grant_type": "refresh_token"})
        r.raise_for_status()
        body = r.json()
        self._token = (body["access_token"], time.time() + int(body.get("expires_in", 3600)))
        return self._token[0]

    def send(self, to: list[str], cc: list[str], subject: str, text: str) -> bool:
        to = [a for a in dict.fromkeys(to) if a]
        cc = [a for a in dict.fromkeys(cc) if a and a not in to]
        if not to:
            return False
        msg = EmailMessage()
        msg["From"] = formataddr((self.sender_name, self.sender))
        msg["To"] = ", ".join(to)
        if cc:
            msg["Cc"] = ", ".join(cc)
        msg["Subject"] = subject
        msg.set_content(text)
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode().rstrip("=")
        try:
            r = self.http.post(SEND_URL, json={"raw": raw},
                               headers={"Authorization": f"Bearer {self._access_token()}"})
            if r.status_code >= 300:
                log.warning("Email not sent: HTTP %s %s", r.status_code, r.text[:300])
                return False
            return True
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            log.warning("Email not sent: %s", exc)
            return False
