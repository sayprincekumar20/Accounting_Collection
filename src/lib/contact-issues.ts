// Contacts to Fix: what is wrong with a client's contact details, how to fix it in Zoho, whether the client
// can still be reached, and which tab shows it. Pure: unit-tested in tests/contact-issues.test.ts.

export type IssueCode =
  | "NO_CONTACT"
  | "NO_PERSON"
  | "NO_MOBILE"
  | "BAD_PHONE"
  | "BOUNCED"
  | "FAKE_EMAIL"
  | "INTERNAL_EMAIL"
  | "INVALID_EMAIL"
  | "WRONG_PERSON";

export interface ContactIssue {
  code: IssueCode;
  /** Short tag shown in the list. */
  label: string;
  /** The specifics (bounce reason, the escalation text…). */
  detail: string;
}

export const ISSUE_INFO: Record<
  IssueCode,
  { label: string; fix: string; field: "email" | "phone" | "person" | "all" }
> = {
  NO_CONTACT: {
    label: "No phone or email",
    fix: "Add an Accounting contact with a mobile number and an email in Zoho CRM (Contacts, Contact of = Accounting).",
    field: "all",
  },
  NO_PERSON: {
    label: "No contact person",
    fix: "Add an Accounting or Primary contact for this account in Zoho CRM.",
    field: "person",
  },
  NO_MOBILE: {
    label: "No mobile number",
    fix: "Add the contact's mobile number (09XX XXX XXXX) in Zoho CRM so SMS, Viber and calls can reach them.",
    field: "phone",
  },
  BAD_PHONE: {
    label: "Invalid mobile number",
    fix: "Correct the mobile number in Zoho CRM: a PH mobile is 09XX XXX XXXX (11 digits).",
    field: "phone",
  },
  BOUNCED: {
    label: "Email bounced",
    fix: "Ask the client or the sales person for the correct email, then update it in Zoho CRM.",
    field: "email",
  },
  FAKE_EMAIL: {
    label: "Placeholder email",
    fix: "Replace the placeholder with the client's real email in Zoho CRM.",
    field: "email",
  },
  INTERNAL_EMAIL: {
    label: "Rare internal email",
    fix: "Replace the @rareglobalfood.com address with the client's own email in Zoho CRM.",
    field: "email",
  },
  INVALID_EMAIL: {
    label: "Invalid email",
    fix: "Correct the email address in Zoho CRM (typo or missing part).",
    field: "email",
  },
  WRONG_PERSON: {
    label: "Wrong / former contact",
    fix: "Confirm the current Accounting contact with the client or the sales person, then update Zoho CRM.",
    field: "person",
  },
};

const EMAIL_CODES: IssueCode[] = ["BOUNCED", "FAKE_EMAIL", "INTERNAL_EMAIL", "INVALID_EMAIL"];

export const isPlaceholderEmail = (email: string) =>
  /(^|[@.])fake|fake\d*@|@example\.|@test\.|noemail|none@|n\/a/.test(email);
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email);

// Common email providers. A domain one or two letters away from one of these is almost certainly a typo
// (SUNRICH123@GMAILLLL.COM, ...@yahooo.com, ...@gmail.con); an exact match is always fine.
const PROVIDERS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.com.ph",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mail.com",
  "email.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
];
const distance = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length]![b.length]!;
};
/** The provider domain an email was probably meant for ("gmail.com" for "gmailll.com"), or "". */
export function emailDomainTypo(email: string): string {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain || PROVIDERS.includes(domain)) return "";
  // Repeated letters collapsed first: "gmaillll.com" -> "gmail.com" (3 letters away, still a typo).
  const squeeze = (s: string) => s.replace(/(.)\1+/g, "$1");
  const repeated = PROVIDERS.find((p) => squeeze(p) === squeeze(domain));
  if (repeated) return repeated;
  const near = PROVIDERS.map((p) => ({ p, d: distance(domain, p) })).sort((x, y) => x.d - y.d)[0];
  return near && near.d > 0 && near.d <= 2 ? near.p : "";
}
/** PH mobile: 63 9XX XXX XXXX, 09XX XXX XXXX or 9XX XXX XXXX. */
export const isPhMobile = (raw: string) =>
  /^(63)?9\d{9}$/.test(raw.replace(/\D/g, "").replace(/^0/, ""));

export function classifyContact(c: {
  email: string;
  phone: string;
  contact_person: string;
  /** Bounce text from contact-bounces (e.g. "Email bounced: address not found (Nov 13)"), if any. */
  bounce?: string;
  /** Escalation text when a client or Grace said it is the wrong / a former contact (last 45 days). */
  wrongPerson?: string;
}): { issues: ContactIssue[]; reach: { email: boolean; phone: boolean } } {
  const email = c.email.trim().toLowerCase();
  const phone = c.phone.replace(/\D/g, "");
  const issues: ContactIssue[] = [];
  const add = (code: IssueCode, detail = "") =>
    issues.push({ code, label: ISSUE_INFO[code].label, detail });
  if (!email && !phone) add("NO_CONTACT");
  else if (!phone) add("NO_MOBILE", "Email only: no SMS, Viber or call possible.");
  if (email && isPlaceholderEmail(email)) add("FAKE_EMAIL", c.email);
  else if (email.endsWith("@rareglobalfood.com")) add("INTERNAL_EMAIL", c.email);
  else if (email && !isValidEmail(email)) add("INVALID_EMAIL", c.email);
  else if (email && emailDomainTypo(email))
    add("INVALID_EMAIL", `${c.email} (looks like a typo for @${emailDomainTypo(email)})`);
  if (c.bounce) add("BOUNCED", c.bounce.replace(/^Email bounced:?\s*/i, ""));
  if (phone && !isPhMobile(phone)) add("BAD_PHONE", c.phone);
  if (!c.contact_person.trim()) add("NO_PERSON", "No Accounting / Primary contact in Zoho CRM.");
  if (c.wrongPerson) add("WRONG_PERSON", c.wrongPerson);
  const emailBad = issues.some((i) => EMAIL_CODES.includes(i.code));
  return {
    issues,
    reach: { email: !!email && !emailBad, phone: !!phone && isPhMobile(phone) },
  };
}

// ------------------------------------------------------------------------------------------- tabs
export type ContactTab = "all" | "unreachable" | "email" | "phone" | "person" | "wrong" | "run";
export interface TabItem {
  issues: ContactIssue[];
  reach: { email: boolean; phone: boolean };
}
export const CONTACT_TABS: { id: ContactTab; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every client with something to fix" },
  {
    id: "unreachable",
    label: "Can't be reached",
    hint: "No working email and no working phone: no reminder can reach them",
  },
  { id: "email", label: "Email problems", hint: "Bounced, placeholder, invalid or internal email" },
  { id: "phone", label: "Phone problems", hint: "No mobile number, or not a valid PH mobile" },
  { id: "person", label: "No contact person", hint: "No Accounting / Primary contact in Zoho CRM" },
  {
    id: "wrong",
    label: "Wrong / former contact",
    hint: "A client or Grace said this is the wrong person (last 45 days)",
  },
  {
    id: "run",
    label: "Last weekly run",
    hint: "Branches the last weekly run could not reach, or reached by email only",
  },
];
const has = (i: TabItem, codes: IssueCode[]) => i.issues.some((x) => codes.includes(x.code));
export function inTab(tab: ContactTab, i: TabItem): boolean {
  switch (tab) {
    case "all":
      return true;
    case "unreachable":
      return !i.reach.email && !i.reach.phone;
    case "email":
      return has(i, EMAIL_CODES);
    case "phone":
      return has(i, ["NO_MOBILE", "BAD_PHONE"]);
    case "person":
      return has(i, ["NO_PERSON"]);
    case "wrong":
      return has(i, ["WRONG_PERSON"]);
    default:
      return false;
  }
}
