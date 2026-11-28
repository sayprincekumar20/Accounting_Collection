"""What is wrong with a client's contact details, and can the client still be reached by email or phone.
Port of dashboard/src/lib/contact-issues.ts (same labels, same rules)."""

import re
from typing import Any

ISSUE_LABELS = {
    "NO_CONTACT": "No phone or email",
    "NO_PERSON": "No contact person",
    "NO_MOBILE": "No mobile number",
    "BAD_PHONE": "Invalid mobile number",
    "BOUNCED": "Email bounced",
    "FAKE_EMAIL": "Placeholder email",
    "INTERNAL_EMAIL": "Rare internal email",
    "INVALID_EMAIL": "Invalid email",
    "WRONG_PERSON": "Wrong / former contact",
}
_EMAIL_CODES = {"BOUNCED", "FAKE_EMAIL", "INTERNAL_EMAIL", "INVALID_EMAIL"}

_PLACEHOLDER = re.compile(r"(^|[@.])fake|fake\d*@|@example\.|@test\.|noemail|none@|n/a")
_VALID_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[a-z]{2,}$")
_PH_MOBILE = re.compile(r"^(63)?9\d{9}$")

# A domain one or two letters away from a common provider is almost certainly a typo (gmaillll.com, yahooo.com).
PROVIDERS = [
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.ph", "ymail.com", "rocketmail.com", "hotmail.com",
    "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mail.com", "email.com", "aol.com",
    "proton.me", "protonmail.com", "zoho.com",
]  # fmt: skip


def is_placeholder_email(email: str) -> bool:
    return bool(_PLACEHOLDER.search(email))


def is_valid_email(email: str) -> bool:
    return bool(_VALID_EMAIL.match(email))


def is_ph_mobile(raw: str) -> bool:
    digits = re.sub(r"\D", "", raw)
    digits = re.sub(r"^0", "", digits, count=1)
    return bool(_PH_MOBILE.match(digits))


def _distance(a: str, b: str) -> int:
    d = [[i] + [0] * len(b) for i in range(len(a) + 1)]
    for j in range(1, len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(
                d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (0 if a[i - 1] == b[j - 1] else 1)
            )
    return d[len(a)][len(b)]


def _squeeze(text: str) -> str:
    return re.sub(r"(.)\1+", r"\1", text)


def email_domain_typo(email: str) -> str:
    """The provider domain an email was probably meant for ("gmail.com" for "gmailll.com"), or ""."""
    parts = email.strip().lower().split("@")
    domain = parts[1] if len(parts) > 1 else ""
    if not domain or domain in PROVIDERS:
        return ""
    repeated = next((p for p in PROVIDERS if _squeeze(p) == _squeeze(domain)), None)
    if repeated:
        return repeated
    nearest = min(PROVIDERS, key=lambda p: _distance(domain, p))
    return nearest if 0 < _distance(domain, nearest) <= 2 else ""


def classify_contact(
    *, email: str, phone: str, contact_person: str, bounce: str = "", wrong_person: str = ""
) -> dict[str, Any]:
    """{"issues": [{code, label, detail}], "reach": {"email": bool, "phone": bool}}."""
    mail = email.strip().lower()
    digits = re.sub(r"\D", "", phone)
    issues: list[dict[str, str]] = []

    def add(code: str, detail: str = "") -> None:
        issues.append({"code": code, "label": ISSUE_LABELS[code], "detail": detail})

    if not mail and not digits:
        add("NO_CONTACT")
    elif not digits:
        add("NO_MOBILE", "Email only: no SMS, Viber or call possible.")
    if mail and is_placeholder_email(mail):
        add("FAKE_EMAIL", email)
    elif mail.endswith("@rareglobalfood.com"):
        add("INTERNAL_EMAIL", email)
    elif mail and not is_valid_email(mail):
        add("INVALID_EMAIL", email)
    elif mail and email_domain_typo(mail):
        add("INVALID_EMAIL", f"{email} (looks like a typo for @{email_domain_typo(mail)})")
    if bounce:
        add("BOUNCED", re.sub(r"^Email bounced:?\s*", "", bounce, flags=re.IGNORECASE))
    if digits and not is_ph_mobile(digits):
        add("BAD_PHONE", phone)
    if not contact_person.strip():
        add("NO_PERSON", "No Accounting / Primary contact in Zoho CRM.")
    if wrong_person:
        add("WRONG_PERSON", wrong_person)
    email_bad = any(i["code"] in _EMAIL_CODES for i in issues)
    return {
        "issues": issues,
        "reach": {"email": bool(mail) and not email_bad, "phone": bool(digits) and is_ph_mobile(digits)},
    }
