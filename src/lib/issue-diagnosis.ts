// AI assistant: diagnosis of the two kinds of issues, kept apart.
//  - SYSTEM: a workflow failure / technical alert (escalations table rows with channel SYSTEM*, see
//    isSystemRow). The error handler [SYSTEM] Error Alert writes the workflow, the failed node, the error
//    and the execution link into `message`.
//  - ESCALATION: a customer case that needs the AR team.
// The rules give the likely root cause and the next steps; the chat AI explains them with the context.
// Pure: unit-tested in tests/issue-diagnosis.test.ts.
import { escalationType } from "./escalation-type";
import { isSystemRow } from "./escalation-alerts";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const at = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;
const DAY = 86400000;

export type IssueKind = "ESCALATION" | "SYSTEM";
export const issueKind = (r: Row): IssueKind => (isSystemRow(r) ? "SYSTEM" : "ESCALATION");

/** Recovery actions the assistant may run (after confirmation). None of the SYSTEM ones contacts a client. */
export type RecoveryAction =
  | "regenerate_statement_pdf"
  | "refresh_client_from_zoho"
  | "call_again"
  | "send_reminder"
  | "update_status";

// ---------------------------------------------------------------------------------------- SYSTEM
export interface SystemFailure {
  workflow: string;
  workflow_id: string;
  node: string;
  error: string;
  execution_id: string;
  execution_url: string;
}

/** Workflow, failed node, error and execution from a system row (message written by the error handler). */
export function parseSystemFailure(r: Row): SystemFailure {
  const msg = s(r["message"]);
  const line = (label: string) =>
    msg.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? "";
  const url = msg.match(/https?:\/\/\S+\/workflow\/([A-Za-z0-9]+)\/executions\/(\d+)/);
  const reason = s(r["reason"]);
  const fromReason = reason.match(/^Workflow failed:\s*(.+?)\s+-\s+(.+)$/s);
  return {
    workflow: line("Workflow") || fromReason?.[1] || s(r["client_name"]),
    workflow_id: url?.[1] ?? "",
    node: line("Failed at"),
    // The reason carries the error's description too (e.g. the Google quota text); the message only the title.
    error: fromReason?.[2] || line("Error") || reason,
    execution_id: url?.[2] ?? "",
    execution_url: url?.[0] ?? "",
  };
}

interface SystemRule {
  category: string;
  test: RegExp;
  root_cause: (f: SystemFailure) => string;
  fixes: string[];
  recovery: RecoveryAction[];
  severity: "urgent" | "high" | "normal";
}

// Order matters: the first match wins (a Drive quota error also says "Forbidden ... check your credentials").
export const SYSTEM_RULES: SystemRule[] = [
  {
    category: "Google Drive API quota",
    test: /quota exceeded[\s\S]*drive\.googleapis|drive\.googleapis[\s\S]*quota|rate ?limit[\s\S]*drive/i,
    root_cause: (f) =>
      `Too many Google Drive requests per minute on the Google Cloud project behind the Drive credential (node "${f.node || "Drive"}"). The quota is per minute, so the run stopped part-way.`,
    fixes: [
      "Re-run after 1 to 2 minutes: the per-minute quota resets by itself.",
      "Statements missed by the stopped run: regenerate them for the clients being contacted.",
      "If it repeats every week: give the Drive credential its own Google Cloud project, or slow the folder searches.",
    ],
    recovery: ["regenerate_statement_pdf"],
    severity: "high",
  },
  {
    category: "Rate limit",
    test: /\b429\b|too many requests|rate ?limit/i,
    root_cause: (f) =>
      `The service called by "${f.node || "a node"}" refused more requests for now (rate limit).`,
    fixes: [
      "Re-run later: rate limits clear by themselves.",
      "If it repeats: add a wait between requests in that node.",
    ],
    recovery: [],
    severity: "normal",
  },
  {
    category: "Credentials or access",
    test: /forbidden|check your credentials|\b401\b|\b403\b|unauthori[sz]ed|invalid_grant|invalid_token|invalid_code|token (has )?expired|access denied|insufficient permission/i,
    root_cause: (f) =>
      `The service refused the credential used by "${f.node || "a node"}": the token expired, access was revoked, or a permission (scope) is missing.`,
    fixes: [
      "In n8n, open the credential used by that node and reconnect / re-authorise it.",
      "Check the account still has access (shared folder, API scope, user not deactivated).",
      "Then re-run the workflow, or wait for its next scheduled run.",
    ],
    recovery: [],
    severity: "urgent",
  },
  {
    category: "Data or mapping error in the workflow",
    test: /invalid input for|expects an? (string|number|boolean|object|array) but we got|is not valid|cannot read propert|undefined is not|unexpected token|json parameter needs to be valid json/i,
    root_cause: (f) =>
      `A value reached "${f.node || "a node"}" in the wrong form (a mapping bug in the workflow, or an unexpected value in the data). It will fail the same way until the workflow is fixed.`,
    fixes: [
      "Open the execution, look at the input of the failed node, and correct the field mapping (convert the value to the expected type).",
      "This needs a workflow change by the person who maintains n8n; re-running alone will not help.",
    ],
    recovery: [],
    severity: "high",
  },
  {
    category: "Temporary network or service outage",
    test: /timed? ?out|etimedout|econnreset|econnrefused|socket hang up|\b50[234]\b|bad gateway|service unavailable|network error/i,
    root_cause: (f) =>
      `The service called by "${f.node || "a node"}" did not answer in time (temporary outage or slow network).`,
    fixes: [
      "Usually passes by itself: re-run, or wait for the next scheduled run.",
      "If it repeats for hours: check the service's status page.",
    ],
    recovery: [],
    severity: "normal",
  },
  {
    category: "SMS gateway phone",
    test: /telerivet|phone[\s\S]*offline|not connected to telerivet|gateway/i,
    root_cause: () =>
      "The Android phone that sends SMS through Telerivet is offline (battery, internet, or the Telerivet Gateway app closed).",
    fixes: [
      "Charge the SMS phone, connect it to the internet and open the Telerivet Gateway app.",
      "Unsent SMS are retried by the next run.",
    ],
    recovery: [],
    severity: "urgent",
  },
  {
    category: "WhatsApp (Twilio)",
    test: /twilio|\b6301[0-9]\b|\b2161[0-9]\b|\b2140[0-9]\b|whatsapp/i,
    root_cause: () =>
      "Twilio refused the WhatsApp message: outside the 24-hour window (only the approved template is allowed), recipient opted out, invalid number, or low balance.",
    fixes: [
      "Check the Twilio error code in the execution.",
      "Low balance: top up Twilio.",
      "Outside the 24-hour window: send the approved template instead of a free message.",
    ],
    recovery: ["send_reminder"],
    severity: "normal",
  },
  {
    category: "Voice (Vapi)",
    test: /vapi|assistant-request|call\.start|customer-did-not|phone ?number[\s\S]*invalid/i,
    root_cause: () =>
      "The call could not be placed by Vapi (invalid number, Vapi key or credit, or a call setting).",
    fixes: [
      "Check the phone number of the client.",
      "Check Vapi credit and the API key.",
      "Place the call again from the Voice page once fixed.",
    ],
    recovery: ["call_again"],
    severity: "normal",
  },
  {
    category: "Zoho API",
    test: /zoho|zohoapis|INVALID_URL_PATTERN|INVALID_DATA|oauth/i,
    root_cause: (f) =>
      `Zoho refused or could not answer the request made by "${f.node || "a node"}".`,
    fixes: [
      "Check the Zoho connection (refresh token) in n8n.",
      "Re-run the refresh, or refresh the affected client.",
    ],
    recovery: ["refresh_client_from_zoho"],
    severity: "high",
  },
  {
    category: "Something not found",
    test: /\b404\b|not found|could not find|does not exist|no item/i,
    root_cause: (f) =>
      `"${f.node || "A node"}" looked for something that does not exist (deleted file, folder, record or wrong id).`,
    fixes: [
      "Open the execution and check which id was looked up.",
      "Recreate or correct the missing item, then re-run.",
    ],
    recovery: [],
    severity: "normal",
  },
];

export interface SystemDiagnosis {
  kind: "SYSTEM";
  failure: SystemFailure;
  category: string;
  root_cause: string;
  fixes: string[];
  recovery: RecoveryAction[];
  severity: "urgent" | "high" | "normal";
  /** Same workflow and same kind of failure in the last 7 days (this one included). */
  recurrence_7d: number;
  first_seen: string;
}

export function diagnoseSystem(row: Row, allRows: Row[] = [], now = Date.now()): SystemDiagnosis {
  const f = parseSystemFailure(row);
  const text = `${f.error} ${s(row["reason"])} ${s(row["message"])}`;
  const rule = SYSTEM_RULES.find((r) => r.test.test(text));
  const category = rule?.category ?? "Unknown";
  const same = allRows.filter((r) => {
    if (!isSystemRow(r) || now - at(r) > 7 * DAY) return false;
    const g = parseSystemFailure(r);
    if (g.workflow !== f.workflow) return false;
    const t = `${g.error} ${s(r["reason"])} ${s(r["message"])}`;
    return (SYSTEM_RULES.find((x) => x.test.test(t))?.category ?? "Unknown") === category;
  });
  const first = same.reduce((m, r) => Math.min(m, at(r)), at(row));
  return {
    kind: "SYSTEM",
    failure: f,
    category,
    root_cause: rule
      ? rule.root_cause(f)
      : `"${f.node || "A node"}" in ${f.workflow || "the workflow"} failed with an error the rules do not recognise.`,
    fixes: rule?.fixes ?? [
      "Open the execution link, read the failed node's error and input, and fix the cause.",
    ],
    recovery: rule?.recovery ?? [],
    severity: rule?.severity ?? "normal",
    recurrence_7d: Math.max(1, same.length),
    first_seen: first ? new Date(first).toISOString() : "",
  };
}

// ---------------------------------------------------------------------------------------- ESCALATION
const STEPS: Record<string, { steps: string[]; recovery: RecoveryAction[] }> = {
  "Paid claim": {
    steps: [
      "Check Zoho Books for the payment (customer payments of the last 7 days).",
      "Found: refresh the client from Zoho so reminders stop, then mark the escalation Done.",
      "Not found: ask the client for proof of payment (deposit slip or reference number).",
    ],
    recovery: ["refresh_client_from_zoho", "send_reminder", "update_status"],
  },
  Dispute: {
    steps: [
      "Pull the invoice(s) the client mentions and check delivery and any credit memo with the sales person.",
      "Reply to the client with the finding; keep reminders paused while it is open (AR hand-off).",
      "Correct the invoice in Zoho if the client is right, then refresh the client.",
    ],
    recovery: ["refresh_client_from_zoho", "update_status"],
  },
  "Document request": {
    steps: [
      "Send the requested statement or invoice copy: regenerate the statement PDF, then send it by email.",
      "Mark the escalation Done once sent.",
    ],
    recovery: ["regenerate_statement_pdf", "send_reminder", "update_status"],
  },
  Callback: {
    steps: [
      "Call the client back (Grace, or an AR team member for a sensitive case).",
      "Record the outcome and any payment date.",
    ],
    recovery: ["call_again", "update_status"],
  },
  "Wrong contact": {
    steps: [
      "Find the correct Accounting contact (sales person or the client's office).",
      "Update the contact in Zoho, then refresh the client so the next reminder reaches the right person.",
    ],
    recovery: ["refresh_client_from_zoho", "update_status"],
  },
  "Contact change": {
    steps: ["Update the new contact details in Zoho.", "Refresh the client from Zoho."],
    recovery: ["refresh_client_from_zoho", "update_status"],
  },
  Other: {
    steps: ["Read the client's last messages and reply to what they asked.", "Record the outcome."],
    recovery: ["send_reminder", "update_status"],
  },
};

export interface EscalationContext {
  client?: Row | undefined;
  conversations: Row[];
  promises: Row[];
  logs: Row[];
  now?: number;
}
export interface EscalationDiagnosis {
  kind: "ESCALATION";
  type: string;
  reason: string;
  status: string;
  age_days: number;
  facts: string[];
  next_steps: string[];
  recovery: RecoveryAction[];
  urgency: "high" | "normal";
  last_client_messages: { channel: string; at: string; text: string }[];
}

const peso = (n: number) =>
  "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const companyKey = (id: unknown) => s(id).split("___")[0]!.trim().toLowerCase();

export function diagnoseEscalation(row: Row, ctx: EscalationContext): EscalationDiagnosis {
  const now = ctx.now ?? Date.now();
  const type = escalationType(row["reason"]);
  const key = companyKey(row["client_id"]);
  const mine = (rows: Row[]) =>
    rows.filter((r) => companyKey(r["client_id"]) === key).sort((a, b) => at(b) - at(a));
  const c = ctx.client;
  const facts: string[] = [];
  if (c) {
    facts.push(
      `Balance ${peso(Number(c["collection_amount"]) || 0)}, overdue ${peso(Number(c["overdue_total"]) || 0)}.`,
    );
    const promise = s(c["promise_suppressed_until"]);
    if (promise && Date.parse(promise) >= now - DAY)
      facts.push(`Payment promise until ${promise.slice(0, 10)}.`);
    const handoff = s(c["ar_handoff_until"]);
    if (handoff && Date.parse(handoff) >= now)
      facts.push(
        `AR is handling this client until ${handoff.slice(0, 10)} (automatic replies paused).`,
      );
    if (s(c["status"]).toUpperCase() === "INACTIVE")
      facts.push("The client is now retired (INACTIVE): nothing is due any more.");
  } else facts.push("The client is no longer in the Clients list (likely paid or retired).");
  const proms = mine(ctx.promises);
  if (proms[0])
    facts.push(
      `Last promise recorded: pay on ${s(proms[0]["promise_date"]).slice(0, 10)} (${s(proms[0]["channel"])}).`,
    );
  const failed = mine(ctx.logs).filter(
    (l) => /FAILED/i.test(s(l["event_type"])) && now - at(l) < 14 * DAY,
  );
  if (failed.length)
    facts.push(
      `${failed.length} failed send(s) in the last 14 days (${[...new Set(failed.map((l) => s(l["channel"])))].join(", ")}).`,
    );
  const inbound = mine(ctx.conversations)
    .filter((m) => s(m["direction"]).toUpperCase() === "INBOUND")
    .slice(0, 5)
    .map((m) => ({
      channel: s(m["channel"]),
      at: s(m["timestamp"]),
      text: s(m["message_text"])
        .split(/\r?\n\s*On [^\n]{0,200}wrote:|\r?\n\s*>/)[0]!
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300),
    }));
  const status = (s(row["status"]) || "OPEN").toUpperCase();
  const age = Math.max(0, Math.floor((now - at(row)) / DAY));
  const plan = STEPS[type] ?? STEPS["Other"]!;
  const urgent =
    status !== "DONE" &&
    (age >= 2 || type === "Dispute" || type === "Paid claim" || failed.length >= 2);
  return {
    kind: "ESCALATION",
    type,
    reason: s(row["reason"]).replace(/\s+/g, " ").slice(0, 400),
    status,
    age_days: age,
    facts,
    next_steps:
      status === "DONE"
        ? ["Already marked Done; reopen it only if the client writes again."]
        : plan.steps,
    recovery: status === "DONE" ? [] : plan.recovery,
    urgency: urgent ? "high" : "normal",
    last_client_messages: inbound,
  };
}
