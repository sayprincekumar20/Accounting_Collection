// Reminder composer (AI assistant): the PRE-APPROVED reminder of each channel, exactly as the n8n channel
// workflows send it, and the rules an edited message must follow before it can be sent.
//
// Source of each template (keep in sync if a workflow's wording changes):
//   EMAIL    05_Email_Channel_Workflow, node "Validate Email" (subject + short SOA follow-up, PDF attached)
//   SMS      01_Collection_Reminder_Orchestrator, node "Build Message Text" (SMS branch, one SMS, max 155)
//   VIBER    04_Viber_Channel_Workflow, node "Build Viber Message" (statement text, PDF attached)
//   WHATSAPP 06_WhatsApp_Channel_Workflow, node "Build WhatsApp Message" (Meta-approved template
//            overdue_invoice_reminder_v3, PDF attached; cannot be edited)
// Pure: unit-tested in tests/reminder-templates.test.ts.

export type ReminderChannel = "EMAIL" | "SMS" | "VIBER" | "WHATSAPP";
export const REMINDER_CHANNELS: ReminderChannel[] = ["EMAIL", "SMS", "VIBER", "WHATSAPP"];
export const CHANNEL_LABEL: Record<ReminderChannel, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  VIBER: "Viber",
  WHATSAPP: "WhatsApp",
};

export interface ReminderClient {
  client_id: string;
  client_name: string;
  contact_person: string;
  email: string;
  phone: string;
  overdue: number;
  current: number;
  total: number;
  /** Status of every open invoice ("OVERDUE" / "CURRENT"), for the SMS invoice counts. */
  invoice_statuses: string[];
  pdf_file_id: string;
  pdf_generated_date: string;
}

export interface ReminderDraft {
  subject: string;
  body: string;
}

const MANILA = 8 * 3600000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const money = (n: number) =>
  Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const manila = (ms: number) => new Date(ms + MANILA);
/** "November 19, 2026" (Manila). */
export const longDate = (ms: number) => {
  const d = manila(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

export const EMAIL_BODY =
  "Hi Ma'am/Sir,\n\nGood day.\n\nWould like to follow up if we have available collection on the overdue invoices. For your reference, please see attached SOA.\n\nThank you.\n\nRegards,\nRare Global Food Trading Corp.\nAccounts Receivable Department";

/** 05 Email: "{CLIENT NAME}_SOA (MM.DD.YY)" + the short follow-up text (statement PDF attached). */
export function emailTemplate(c: ReminderClient, now = Date.now()): ReminderDraft {
  const d = manila(now);
  const stamp = `${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCFullYear()).slice(-2)}`;
  return { subject: `${c.client_name || "Valued Customer"}_SOA (${stamp})`, body: EMAIL_BODY };
}

/** 01 orchestrator SMS: invoice counts, first name, always one SMS (max 155 characters). */
export function smsTemplate(c: ReminderClient): ReminderDraft {
  const overdueN = c.invoice_statuses.filter((s) => s.toUpperCase() === "OVERDUE").length;
  const currentN = c.invoice_statuses.length - overdueN;
  const count = (n: number, kind: string) => `${n} ${kind} ${n === 1 ? "invoice" : "invoices"}`;
  const parts: string[] = [];
  if (overdueN) parts.push(count(overdueN, "overdue"));
  if (currentN) parts.push(count(currentN, "current"));
  const what = parts.length ? parts.join(" and ") : "an outstanding balance";
  const tail = " Please settle or reply with your payment date. Thank you!";
  const shortTail = " Please settle or reply with your payment date.";
  const firstName = c.contact_person.trim().split(/\s+/)[0] || "";
  const hiName = firstName ? `Hi ${firstName}` : "Hi";
  const build = (hi: string, co: string, end: string) =>
    `${hi}, you have ${what} with ${co} totaling PHP ${money(c.total)}.${end}`;
  const candidates = [
    build(hiName, "Rare Global Food Trading Corp", tail),
    build(hiName, "Rare Global Food", tail),
    build(hiName, "Rare Global Food", shortTail),
    build("Hi", "Rare Global Food", tail),
    build("Hi", "Rare Global Food", shortTail),
  ];
  return {
    subject: "",
    body: candidates.find((t) => smsLength(t) <= SMS_MAX) ?? candidates[candidates.length - 1]!,
  };
}

/** 04 Viber: the statement text (statement PDF attached). */
export function viberTemplate(c: ReminderClient, now = Date.now()): ReminderDraft {
  const name = c.contact_person || c.client_name || "Valued Customer";
  return {
    subject: "",
    body: `Hello ${name}, as of ${longDate(now)}, your account statement from Rare Global Food Trading Corp. shows:\n\nOverdue balance: PHP ${money(c.overdue)}\nCurrent balance: PHP ${money(c.current)}\nTotal balance: PHP ${money(c.total)}\n\nPlease see the attached statement for details. Thank you.`,
  };
}

/** 06 WhatsApp: the Meta-approved template as the client will read it (not editable). */
export function whatsappPreview(c: ReminderClient, now = Date.now()): ReminderDraft {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const gen = new Date(c.pdf_generated_date).getTime();
  const asOf = longDate(gen > 0 ? gen : now);
  return {
    subject: "",
    body: `Hello ${clean(c.contact_person || c.client_name)}, as of ${asOf} your account statement from Rare Global Food Trading Corp. shows: Overdue balance: PHP ${money(c.overdue)}. Current balance: PHP ${money(c.current)}. Total balance: PHP ${money(c.total)}. Please see the attached statement for details.`,
  };
}

export function templateFor(
  ch: ReminderChannel,
  c: ReminderClient,
  now = Date.now(),
): ReminderDraft {
  if (ch === "EMAIL") return emailTemplate(c, now);
  if (ch === "SMS") return smsTemplate(c);
  if (ch === "VIBER") return viberTemplate(c, now);
  return whatsappPreview(c, now);
}

// ---------------------------------------------------------------------------------------- channel rules
export const SMS_MAX = 155; // 07_SMS cuts every message at 155 characters: one SMS part, never cut mid-word
export const VIBER_MAX = 1000;
export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX = 5000;
export const PDF_MAX_AGE_DAYS = 8; // WhatsApp refuses a statement older than 8 days (06)

// GSM 03.38: the only characters an SMS can carry without dropping to 70 characters per part.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€"; // allowed, but each counts as 2 characters
/** Length as the SMS network counts it (extended characters count twice). */
export function smsLength(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM_EXTENDED.includes(ch) ? 2 : 1;
  return n;
}
/** Characters an SMS cannot carry (e.g. ₱, emoji, curly quotes). */
export function nonGsmChars(text: string): string[] {
  return [
    ...new Set([...text].filter((ch) => !GSM_BASIC.includes(ch) && !GSM_EXTENDED.includes(ch))),
  ];
}

const LINK = /(https?:\/\/|www\.)\S+/i;

/** What is wrong with an (edited) message for this channel; empty = it can be sent. */
export function validateReminder(ch: ReminderChannel, d: ReminderDraft): string[] {
  const errors: string[] = [];
  const body = d.body ?? "";
  if (ch === "WHATSAPP") return errors; // the approved template is sent as is
  if (!body.trim()) errors.push("The message is empty.");
  if (LINK.test(body) || (ch === "EMAIL" && LINK.test(d.subject)))
    errors.push("Links are not allowed: the statement is attached as a PDF, never sent as a link.");
  if (ch === "SMS") {
    const bad = nonGsmChars(body);
    if (bad.length)
      errors.push(
        `Characters an SMS cannot carry: ${bad.join(" ")} (write PHP instead of ₱, use plain quotes, no emoji).`,
      );
    const n = smsLength(body);
    if (n > SMS_MAX)
      errors.push(`Too long for one SMS: ${n} of ${SMS_MAX} characters (the SMS would be cut).`);
  }
  if (ch === "VIBER" && body.length > VIBER_MAX)
    errors.push(`Too long for Viber: ${body.length} of ${VIBER_MAX} characters.`);
  if (ch === "EMAIL") {
    if (!d.subject.trim()) errors.push("The subject is empty.");
    if (/[\r\n]/.test(d.subject)) errors.push("The subject must be one line.");
    if (d.subject.length > EMAIL_SUBJECT_MAX)
      errors.push(
        `The subject is too long: ${d.subject.length} of ${EMAIL_SUBJECT_MAX} characters.`,
      );
    if (body.length > EMAIL_BODY_MAX)
      errors.push(`The email is too long: ${body.length} of ${EMAIL_BODY_MAX} characters.`);
  }
  return errors;
}

/** A Philippine mobile number: 63 + 9XX XXX XXXX. */
export function isPhMobile(raw: string): boolean {
  const d = String(raw || "").replace(/\D/g, "");
  const f =
    d.length === 11 && d.startsWith("0") ? "63" + d.slice(1) : d.length === 10 ? "63" + d : d;
  return /^639\d{9}$/.test(f);
}

/** Can this channel reach the client? (reason when it cannot). */
export function channelAvailability(
  ch: ReminderChannel,
  c: ReminderClient,
  now = Date.now(),
): { available: boolean; reason: string; attachment: string } {
  const gen = new Date(c.pdf_generated_date).getTime();
  const pdf = !!c.pdf_file_id;
  const ageDays = gen > 0 ? (now - gen) / 86400000 : Infinity;
  const pdfNote = pdf ? `+ statement PDF (made ${longDate(gen > 0 ? gen : now)})` : "";
  if (ch === "EMAIL") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim()))
      return { available: false, reason: "No valid email address on file", attachment: "" };
    if (!pdf)
      return {
        available: false,
        reason: "No statement PDF yet (it is made by the Zoho refresh)",
        attachment: "",
      };
    return { available: true, reason: "", attachment: pdfNote };
  }
  if (!isPhMobile(c.phone))
    return {
      available: false,
      reason: c.phone
        ? `Phone ${c.phone} is not a valid PH mobile number`
        : "No mobile number on file",
      attachment: "",
    };
  if (ch === "SMS") return { available: true, reason: "", attachment: "" };
  if (ch === "VIBER")
    return {
      available: true,
      reason: "",
      attachment: pdf ? pdfNote : "no statement PDF yet: text only",
    };
  if (!pdf || ageDays > PDF_MAX_AGE_DAYS)
    return {
      available: false,
      reason: `WhatsApp needs a statement PDF made in the last ${PDF_MAX_AGE_DAYS} days`,
      attachment: "",
    };
  return { available: true, reason: "", attachment: pdfNote };
}
