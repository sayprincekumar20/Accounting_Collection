"""Emails about a verification, to the internal team only: To = who clicked Verify Account,
CC = the Account Owner (the Zoho user who leads the account); expiry reminders: To = the Account
Owner, CC = the last requester. Each email = sections (missing / expired documents, checks not
met, fields updated...) rendered as HTML with a plain-text copy. No links."""

import re
from html import escape

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
SENDER = "Rare Global Food - Document Verification"

# section tones: (left border colour, title colour)
_TONES = {"alert": ("#B42318", "#B42318"), "warn": ("#B54708", "#B54708"),
          "ok": ("#067647", "#067647"), "info": ("#475467", "#344054")}


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
    """To: the person who started it; CC: the Account Owner (if different). No requester ->
    the owner is the recipient."""
    to = valid([requester]) or valid([owner])
    cc = [a for a in valid([owner]) if a.lower() not in (t.lower() for t in to)]
    return to, cc


# ------------------------------------------------------------------ facts from an assessment
def document_facts(assessment: dict | None) -> dict:
    """What the emails report, from the stored assessment."""
    from app.assessment.alerts import label
    a = assessment or {}
    reqs = a.get("requirements") or []

    def _date(iso):
        from app.zoho.review_record import _date as fmt
        return fmt(iso) if iso else ""
    conflicts = [c for c in a.get("cross_document") or []
                 if c.get("status") == "CONFLICT" and c.get("severity") == "CRITICAL"]
    return {
        "missing": [label(r["document_type"]) for r in reqs if r["status"] == "MISSING"],
        "expired": [f"{label(r['document_type'])} - expired on {_date(r.get('valid_until'))}"
                    for r in reqs if r["status"] == "EXPIRED"],
        "unclear": [f"{label(r['document_type'])} - expiry date could not be read"
                    for r in reqs if r["status"] == "UNKNOWN"],
        "checks_failed": [f"{c['label']}: {c['detail']}"
                          for c in a.get("activation_checks") or [] if c["status"] == "FAIL"],
        "checks_total": len(a.get("activation_checks") or []),
        "conflicts": [f"{str(c.get('attribute', '')).replace('_', ' ').capitalize()} differs "
                      "between documents" for c in conflicts],
    }


def _document_sections(facts: dict) -> list:
    out = []
    if facts.get("expired"):
        out.append(("Expired documents - renewal needed", facts["expired"], "alert"))
    if facts.get("missing"):
        out.append(("Missing documents - still to collect", facts["missing"], "warn"))
    if facts.get("unclear"):
        out.append(("Documents to check", facts["unclear"], "warn"))
    return out


# ------------------------------------------------------------------ rendering
def _compose(subject: str, intro: list[str], sections: list, closing: list[str]
             ) -> tuple[str, str, str]:
    """(subject, plain text, html)."""
    text = ["Hello,", ""] + intro
    for title, items, _tone in sections:
        text += ["", title.upper()] + [f"  - {i}" for i in items]
    if closing:
        text += [""] + closing
    text += ["", "Regards,", SENDER, "(This is an automatic message.)"]

    html = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;'
            'line-height:1.5;color:#101828;max-width:640px">', "<p>Hello,</p>"]
    html += [f"<p>{escape(p)}</p>" for p in intro if p]
    for title, items, tone in sections:
        border, colour = _TONES.get(tone, _TONES["info"])
        html.append(f'<div style="border-left:4px solid {border};padding:6px 0 6px 12px;'
                    'margin:14px 0">'
                    f'<div style="font-weight:bold;color:{colour};margin-bottom:4px">'
                    f"{escape(title)}</div>"
                    '<ul style="margin:0;padding-left:20px">'
                    + "".join(f"<li>{escape(i)}</li>" for i in items) + "</ul></div>")
    html += [f"<p>{escape(p)}</p>" for p in closing if p]
    html.append('<p style="margin-top:20px">Regards,<br>' + escape(SENDER) + "</p>"
                '<p style="color:#667085;font-size:12px">This is an automatic message.</p>'
                "</div>")
    return subject, "\n".join(text), "".join(html)


def _who(name: str, number: str) -> str:
    return f"{name} ({number})" if number else name


# ------------------------------------------------------------------ the emails
def activated(name: str, number: str, facts: dict) -> tuple[str, str, str]:
    docs = _document_sections(facts)
    subject = (f"Account activated - expired document to renew: {name}" if facts.get("expired")
               else f"Account activated - documents to collect: {name}" if docs
               else f"Account activated: {name}")
    intro = [f"{_who(name, number)} passed document verification and is now Active in Zoho CRM. "
             f"All {facts.get('checks_total') or 5} activation checks passed."]
    closing = (["Please collect the documents listed above from the customer, attach them to the "
                "Account in Zoho CRM and click Verify Account again."] if docs else [])
    return _compose(subject, intro, docs, closing)


def verified_already_active(name: str, number: str, facts: dict) -> tuple[str, str, str]:
    docs = _document_sections(facts)
    intro = [f"{_who(name, number)} was verified. The account is already Active.",
             "Some field updates from the documents are waiting for the accounts team's decision."]
    closing = (["Please collect the documents listed above and click Verify Account again once "
                "they are attached."] if docs else [])
    return _compose(f"Account verified: {name}", intro, docs, closing)


def needs_review(name: str, number: str, facts: dict) -> tuple[str, str, str]:
    sections = []
    if facts.get("conflicts"):
        sections.append(("Documents disagree", facts["conflicts"]
                         + ["Check that all documents belong to this customer."], "alert"))
    sections += _document_sections(facts)
    if facts.get("checks_failed"):
        sections.append(("Activation checks not met", facts["checks_failed"], "warn"))
    intro = [f"The documents of {_who(name, number)} were checked. The account cannot be "
             "activated automatically and needs a review by the accounts team."]
    closing = ["What to do: collect any missing documents, correct the items above in Zoho CRM "
               "and click Verify Account again. You will receive another email with the "
               "accounts team's decision."]
    return _compose(f"Verification in review: {name}", intro, sections, closing)


def approved(name: str, reviewer: str, updated: list[str], conflicts: int,
             activated_now: bool, facts: dict | None = None) -> tuple[str, str, str]:
    sections = []
    if updated:
        sections.append(("Updated in Zoho CRM", updated, "ok"))
    if conflicts:
        sections.append(("Not written", [f"{conflicts} field(s) were changed in Zoho in the "
                                         "meantime and were not overwritten; the accounts team "
                                         "will check them."], "warn"))
    sections += _document_sections(facts or {})
    intro = [f"The verification of {name} was approved by {reviewer}.",
             "Customer Status: Active." if activated_now else "Customer Status was not changed."]
    closing = (["Please collect the documents listed above and click Verify Account again once "
                "they are attached."] if _document_sections(facts or {}) else [])
    return _compose(f"Verification approved: {name}", intro, sections, closing)


def waiting_for_documents(name: str, reviewer: str, notes: str,
                          facts: dict | None = None) -> tuple[str, str, str]:
    sections = [("Requested by the accounts team", [notes.strip() or "See the review."], "warn")]
    sections += _document_sections(facts or {})
    intro = [f"The accounts team ({reviewer}) needs more documents for {name} before it can be "
             "verified."]
    closing = ["Please collect them, attach them to the Account in Zoho CRM and click Verify "
               "Account again."]
    return _compose(f"Documents needed: {name}", intro, sections, closing)


def rejected(name: str, reviewer: str, notes: str) -> tuple[str, str, str]:
    intro = [f"The verification of {name} was not approved by {reviewer}.",
             "Nothing was changed in Zoho CRM."]
    sections = [("Reason", [notes.strip() or "No reason given."], "alert")]
    return _compose(f"Verification not approved: {name}", intro, sections, [])


def failed(name: str) -> tuple[str, str, str]:
    intro = [f"The approved changes for {name} could not be written to Zoho CRM. The accounts "
             "team has been informed and will check it."]
    return _compose(f"Verification could not be completed: {name}", intro, [], [])


def not_completed(name: str, reason: str, no_documents: bool,
                  files: list[str] | None = None) -> tuple[str, str, str]:
    sections = [("Reason", [reason], "alert")]
    if files:
        sections.append(("Files found on the Account", files, "info"))
    closing = (["Please attach the documents (BIR 2303, DTI or SEC certificate, Mayor's permit) "
                "to the Account as PDF or image files, then click Verify Account again."]
               if no_documents else
               ["Please click Verify Account again in a few minutes. If it fails again, contact "
                "the CRM admin."])
    intro = [f"The verification of {name} could not be completed."]
    return _compose(f"Verification could not be completed: {name}", intro, sections, closing)


def expiring(name: str, number: str, document: str, when: str) -> tuple[str, str, str]:
    expired_now = "expired" in when
    state = "has expired" if expired_now else "expires soon"
    intro = [f"A document of {_who(name, number)} {state}."]
    sections = [("Expired document - renewal needed" if expired_now else "Document expiring",
                 [f"{document}: {when}"], "alert" if expired_now else "warn")]
    closing = [f"Please collect the renewed {document} from the customer, attach it to the "
               "Account in Zoho CRM and click Verify Account."]
    return _compose(f"{document} {'expired' if expired_now else 'expiring'}: {name}", intro,
                    sections, closing)
