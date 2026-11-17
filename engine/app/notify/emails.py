"""Plain-text emails about a verification: to the person who clicked Verify Account, CC the
Account owner (expiry reminders: to the owner, CC the last requester). Wording lives here."""

import re

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
SIGN_OFF = "\n\n-- \nRare Global Food - Document Verification (automatic message)"


def valid(addresses) -> list[str]:
    out = []
    for a in addresses:
        a = str(a or "").strip()
        if _EMAIL.match(a) and a.lower() not in (x.lower() for x in out):
            out.append(a)
    return out


def owner_email(snapshot: dict | None) -> str | None:
    owner = (snapshot or {}).get("Owner")
    return owner.get("email") if isinstance(owner, dict) else None


def recipients(requester: str | None, owner: str | None) -> tuple[list[str], list[str]]:
    """To: the person who started it; CC: the Account owner (if different). No requester ->
    the owner is the recipient."""
    to = valid([requester]) or valid([owner])
    cc = [a for a in valid([owner]) if a.lower() not in (t.lower() for t in to)]
    return to, cc


def _body(lines: list[str], links: str) -> str:
    return "\n".join(lines) + (f"\n\n{links}" if links else "") + SIGN_OFF


def activated(name: str, number: str, links: str) -> tuple[str, str]:
    return (f"Account activated: {name}", _body([
        "Hello,", "",
        f"{name}{f' ({number})' if number else ''} is now Active in Zoho CRM.",
        "All required documents are valid and every activation check passed.",
    ], links))


def needs_review(name: str, number: str, reasons: list[str], links: str) -> tuple[str, str]:
    items = "\n".join(f"- {r}" for r in reasons) or "- The accounts team will confirm it."
    return (f"Verification in review: {name}", _body([
        "Hello,", "",
        f"The documents of {name}{f' ({number})' if number else ''} were checked. "
        "The account needs a review by the accounts team:", "", items, "",
        "You will get another email with their decision.",
    ], links))


def approved(name: str, reviewer: str, fields: list[str], conflicts: int,
             activated_now: bool, links: str) -> tuple[str, str]:
    lines = ["Hello,", "", f"The verification of {name} was approved by {reviewer}."]
    if fields:
        lines.append("Updated in Zoho CRM: " + ", ".join(fields) + ".")
    if conflicts:
        lines.append(f"{conflicts} field(s) were not written because the Account was changed "
                     "in the meantime; the accounts team will check them.")
    lines.append("Customer Status: Active." if activated_now
                 else "Customer Status was not changed.")
    return (f"Verification approved: {name}", _body(lines, links))


def waiting_for_documents(name: str, reviewer: str, notes: str, links: str) -> tuple[str, str]:
    return (f"Documents needed: {name}", _body([
        "Hello,", "",
        f"The accounts team ({reviewer}) needs more documents for {name}:", "",
        notes.strip() or "(see the review)", "",
        "Please collect them, attach them to the Account in Zoho CRM and click "
        "Verify Account again.",
    ], links))


def rejected(name: str, reviewer: str, notes: str, links: str) -> tuple[str, str]:
    return (f"Verification not approved: {name}", _body([
        "Hello,", "",
        f"The verification of {name} was not approved by {reviewer}.",
        f"Reason: {notes.strip() or '(no reason given)'}", "",
        "Nothing was changed in Zoho CRM.",
    ], links))


def failed(name: str, links: str) -> tuple[str, str]:
    return (f"Verification could not be completed: {name}", _body([
        "Hello,", "",
        f"The approved changes for {name} could not be written to Zoho CRM. "
        "The accounts team has been informed and will check it.",
    ], links))


def expiring(name: str, number: str, document: str, when: str, links: str) -> tuple[str, str]:
    return (f"{document} {('expired' if 'expired' in when else 'expiring')}: {name}", _body([
        "Hello,", "",
        f"The {document} of {name}{f' ({number})' if number else ''} {when}.",
        f"Please collect the renewed {document} from the customer, attach it to the Account in "
        "Zoho CRM and click Verify Account.",
    ], links))
