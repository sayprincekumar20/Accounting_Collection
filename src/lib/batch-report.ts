// Approval batch reports: one report per AR approval action (n8n workflow 28 saves each action in the table
// approval_batches, with each client's balance and open invoices at that moment).
//
// A batch report covers ONLY the clients approved in that batch, and only what happened to them between the
// approval and the earlier of: the same client's next approval (a later batch), or the end of the weekly cycle
// (the next Wednesday 00:00 Manila). So two batches never share an action.
//
// Pure functions (no I/O): unit-tested in tests/batch-report.test.ts.
import { escalationType } from "./escalation-type";
import { isNotReachedReason } from "./escalation-alerts";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
export const companyKey = (id: unknown) => s(id).split("___")[0]!.trim().toLowerCase();
const at = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;
const MANILA = 8 * 3600000;

export interface BatchClient {
  client_id: string;
  client_name: string;
  balance: number | null;
  overdue: number | null;
  /** [invoice no., open balance, "O" overdue | "C" current] at approval; null when not recorded. */
  invoices: [string, number, string][] | null;
  removed_at?: string;
}
export interface Batch {
  batch_id: string;
  approved_at: string;
  approved_by: string;
  source: string;
  note: string;
  client_count: number;
  balance_at_approval: number | null;
  overdue_at_approval: number | null;
  clients: BatchClient[];
}

export function parseBatch(r: Row): Batch | null {
  const id = s(r["batch_id"]);
  const when = s(r["approved_at"]);
  if (!id || !when || !(new Date(when).getTime() > 0)) return null;
  let clients: BatchClient[] = [];
  try {
    const raw = JSON.parse(s(r["clients_json"]) || "[]") as Row[];
    clients = (Array.isArray(raw) ? raw : [])
      .filter((c) => c && s(c["client_id"]))
      .map((c) => ({
        client_id: s(c["client_id"]),
        client_name: s(c["client_name"]),
        balance: c["balance"] == null ? null : num(c["balance"]),
        overdue: c["overdue"] == null ? null : num(c["overdue"]),
        invoices: Array.isArray(c["invoices"])
          ? (c["invoices"] as unknown[][]).map((x) => [s(x[0]), num(x[1]), s(x[2]) || "O"])
          : null,
        removed_at: s(c["removed_at"]),
      }));
  } catch {
    clients = [];
  }
  const nb = (v: unknown) => (v == null || v === "" ? null : num(v));
  return {
    batch_id: id,
    approved_at: when,
    approved_by: s(r["approved_by"]),
    source: s(r["source"]),
    note: s(r["note"]),
    client_count: clients.length,
    balance_at_approval: nb(r["balance_at_approval"]),
    overdue_at_approval: nb(r["overdue_at_approval"]),
    clients,
  };
}

/** The end of the weekly cycle that contains `ms`: the next Wednesday 00:00 Manila (strictly after). */
export function cycleEnd(ms: number): number {
  const local = new Date(ms + MANILA);
  const day = local.getUTCDay(); // 0 Sunday .. 3 Wednesday
  const add = (3 - day + 7) % 7 || 7;
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add);
  return midnight - MANILA;
}

/** From this batch's approval to the client's next approval (later batch) or the end of the cycle. */
export function clientWindow(
  batch: Batch,
  clientId: string,
  batches: Batch[],
  now = Date.now(),
): { start: number; end: number } {
  const start = new Date(batch.approved_at).getTime();
  const key = companyKey(clientId);
  const next = batches
    .map((b) => new Date(b.approved_at).getTime())
    .filter(
      (t, i) =>
        t > start &&
        batches[i]!.clients.some((c) => !c.removed_at && companyKey(c.client_id) === key),
    )
    .sort((a, b) => a - b)[0];
  return { start, end: Math.min(next ?? Infinity, cycleEnd(start), now) };
}

const NOT_ANSWERED = new Set([
  "customer-did-not-answer",
  "customer-busy",
  "voicemail",
  "customer-did-not-give-microphone-permission",
]);
/** Same rule as the Voice page: connected (picked up) / not answered / failed to connect. */
export function callOutcome(
  endedReason: string,
  status = "",
): "connected" | "not_answered" | "failed" {
  const r = endedReason || "";
  if (NOT_ANSWERED.has(r)) return "not_answered";
  if (
    /error|failed|misdialed|rejected|disconnected|not-found|not-valid|canceled|deleted|shutdown|timed-out-join|join-timed-out/.test(
      r,
    ) ||
    r.startsWith("call.")
  )
    return "failed";
  if (!r) return status === "ended" || status === "completed" ? "connected" : "failed";
  return "connected";
}
const RESULT_LABEL: Record<string, string> = {
  "customer-did-not-answer": "No answer",
  "customer-busy": "Line busy",
  voicemail: "Voicemail",
  "customer-ended-call": "Answered (customer ended the call)",
  "assistant-ended-call": "Answered (Grace ended the call)",
  "assistant-said-end-call-phrase": "Answered (Grace ended the call)",
  "assistant-ended-call-after-message-spoken": "Answered (Grace ended the call)",
  "silence-timed-out": "Answered, no response (silence)",
  "exceeded-max-duration": "Answered (max duration)",
  "twilio-failed-to-connect-call": "Failed to connect",
};
export const callResultLabel = (r: string) =>
  RESULT_LABEL[r] ??
  (r ? r.replace(/^call\.[a-z.-]+\./, "").replace(/-/g, " ") : "Result not available");

/** Only what the customer wrote: an email reply also carries the quoted thread ("On … wrote:", "> …"). */
export function replyOnly(text: string): string {
  const cut =
    text.split(
      /\r?\n\s*On [^\n]{0,200}(?:\r?\n[^\n]{0,200})?wrote:|\r?\n\s*>|\r?\n-{2,}\s*Original Message|\r?\nFrom: /i,
    )[0] ?? text;
  return cut.trim() || text.trim();
}

export interface CallInfo {
  endedReason: string;
  status: string;
}

export interface ClientOutcome {
  client_id: string;
  client_name: string;
  removed_at: string;
  window_start: string;
  window_end: string;
  texts: { channel: string; at: string; ok: boolean; fallback: boolean; error: string }[];
  channels_used: string[];
  fallback: string;
  text_status: string;
  calls: {
    at: string;
    result: string;
    outcome: "connected" | "not_answered" | "failed" | "unknown";
  }[];
  call_status: string;
  picked_up: "Yes" | "No" | "Unknown" | "";
  not_reached_alert: boolean;
  replies: { channel: string; at: string; text: string }[];
  confirmation: string;
  ptp_date: string;
  escalation: string;
  escalation_status: string;
  balance_at_approval: number | null;
  balance_now: number | null;
  collected: number | null;
  paid_invoices: string[];
  outcome: string;
}

const peso = (n: number) =>
  "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TEXT_CHANNELS = new Set(["EMAIL", "SMS", "VIBER", "WHATSAPP"]);

/** Current open balance and open invoice numbers of a client row (Clients table). */
export function openInvoices(c: Row | undefined): { no: string; inv: Row; branch: Row }[] {
  if (!c) return [];
  const out: { no: string; inv: Row; branch: Row }[] = [];
  let branches: Row[] = [];
  try {
    branches = JSON.parse(s(c["branches_data"]) || "[]") as Row[];
  } catch {
    branches = [];
  }
  for (const b of Array.isArray(branches) ? branches : []) {
    let invs: Row[] = [];
    try {
      invs = JSON.parse(s(b["invoice_details"]) || "[]") as Row[];
    } catch {
      invs = [];
    }
    for (const inv of Array.isArray(invs) ? invs : [])
      if (num(inv["balance"]) > 0) out.push({ no: s(inv["invoice_number"]), inv, branch: b });
  }
  return out;
}

export function clientOutcome(a: {
  batch: Batch;
  bc: BatchClient;
  batches: Batch[];
  client: Row | undefined;
  logs: Row[];
  conversations: Row[];
  promises: Row[];
  escalations: Row[];
  calls: Map<string, CallInfo>;
  now?: number;
}): ClientOutcome {
  const now = a.now ?? Date.now();
  const w = clientWindow(a.batch, a.bc.client_id, a.batches, now);
  const key = companyKey(a.bc.client_id);
  const mine = (rows: Row[]) =>
    rows
      .filter((r) => companyKey(r["client_id"]) === key)
      .filter((r) => at(r) >= w.start && at(r) < w.end)
      .sort((x, y) => at(x) - at(y));
  const iso = (ms: number) => (ms ? new Date(ms).toISOString() : "");

  const logs = mine(a.logs);
  const texts = logs
    .filter((l) => TEXT_CHANNELS.has(s(l["channel"]).toUpperCase()))
    .filter((l) => /SEND_SUCCESS|SEND_FAILED/i.test(s(l["event_type"])))
    .map((l) => ({
      channel: s(l["channel"]).toUpperCase(),
      at: iso(at(l)),
      ok: /SEND_SUCCESS/i.test(s(l["event_type"])),
      fallback: l["is_fallback"] === true || s(l["is_fallback"]) === "true",
      error: s(l["error_message"]).slice(0, 160),
    }));
  const channels_used = [...new Set(texts.filter((t) => t.ok).map((t) => t.channel))];
  const fb = texts.filter((t) => t.fallback);
  const fallback = fb.length
    ? [...new Set(fb.map((t) => `${t.channel} (${t.ok ? "sent" : "failed"})`))].join(", ")
    : "";
  const failed = texts.filter((t) => !t.ok);
  const text_status = a.bc.removed_at
    ? "Approval removed"
    : channels_used.length
      ? `Sent (${channels_used.join(", ")})` + (failed.length ? `; ${failed.length} failed` : "")
      : failed.length
        ? `Failed: ${failed[failed.length - 1]!.error || failed[failed.length - 1]!.channel}`
        : "Not sent";

  const calls = logs
    .filter(
      (l) =>
        s(l["channel"]).toUpperCase() === "VOICE" && /CALL_INITIATED/i.test(s(l["event_type"])),
    )
    .map((l) => {
      const info = a.calls.get(s(l["message_id"]));
      return {
        at: iso(at(l)),
        result: info ? callResultLabel(info.endedReason) : "Result not available",
        outcome: info ? callOutcome(info.endedReason, info.status) : ("unknown" as const),
      };
    });
  const callFails = logs.filter(
    (l) =>
      s(l["channel"]).toUpperCase() === "VOICE" &&
      /SEND_FAILED|CALL_FAILED/i.test(s(l["event_type"])),
  );
  const picked_up: ClientOutcome["picked_up"] = !calls.length
    ? ""
    : calls.some((c) => c.outcome === "connected")
      ? "Yes"
      : calls.every((c) => c.outcome === "unknown")
        ? "Unknown"
        : "No";
  const call_status = !calls.length
    ? callFails.length
      ? `Call failed to start: ${s(callFails[callFails.length - 1]!["error_message"]).slice(0, 120) || "error"}`
      : "Not called"
    : calls.map((c) => c.result).join(", then ");
  const escs = mine(a.escalations).filter((e) => s(e["channel"]).toUpperCase() !== "SYSTEM");
  const not_reached_alert = escs.some((e) => isNotReachedReason(e["reason"]));
  const realEsc = escs.filter((e) => !isNotReachedReason(e["reason"]));
  const lastEsc = realEsc[realEsc.length - 1];

  const replies = mine(a.conversations)
    .filter((c) => s(c["direction"]).toUpperCase() === "INBOUND")
    .map((c) => ({
      channel: s(c["channel"]).toUpperCase(),
      at: iso(at(c)),
      text: replyOnly(s(c["message_text"])).replace(/\s+/g, " ").slice(0, 200),
    }));
  const proms = mine(a.promises);
  const lastProm = proms[proms.length - 1];
  const ptp_date = lastProm ? s(lastProm["promise_date"]).slice(0, 10) : "";

  const confirmation = ptp_date
    ? `Promised to pay on ${ptp_date}`
    : lastEsc
      ? `${escalationType(lastEsc["reason"])}: ${s(lastEsc["reason"]).replace(/\s+/g, " ").slice(0, 120)}`
      : replies.length
        ? "Replied (no promise yet)"
        : calls.some((c) => c.outcome === "connected")
          ? "Spoke on the phone (no promise)"
          : "No response";
  const escalation = lastEsc
    ? `YES: ${s(lastEsc["reason"]).replace(/\s+/g, " ").slice(0, 120)}${s(lastEsc["ref"]) ? ` (Ref ${s(lastEsc["ref"])})` : ""}`
    : "";
  const escalation_status = lastEsc ? (s(lastEsc["status"]) || "OPEN").replace("_", " ") : "";

  // Collection since approval: balance then (saved with the batch) vs balance now (Clients table).
  const open = openInvoices(a.client);
  const nowBal = a.client
    ? s(a.client["status"]).toUpperCase() === "INACTIVE"
      ? 0
      : r2(open.reduce((t, x) => t + num(x.inv["balance"]), 0))
    : null;
  const then = a.bc.balance;
  const collected = then != null && nowBal != null ? r2(Math.max(0, then - nowBal)) : null;
  const openNos = new Set(open.map((x) => x.no));
  const paid_invoices = (a.bc.invoices ?? []).filter((x) => !openNos.has(x[0])).map((x) => x[0]);

  const outcome = a.bc.removed_at
    ? "Approval removed (not contacted)"
    : then != null && then > 0 && nowBal === 0
      ? "Fully paid"
      : collected != null && collected > 0
        ? `Partly paid (${peso(collected)})`
        : ptp_date
          ? `Promise to pay (${ptp_date})`
          : lastEsc
            ? "Escalated to AR"
            : replies.length
              ? "Replied, no payment yet"
              : texts.some((t) => t.ok) || calls.length
                ? "Contacted, no response yet"
                : "Not contacted yet";

  return {
    client_id: a.bc.client_id,
    client_name: a.bc.client_name || s(a.client?.["client_name"]),
    removed_at: a.bc.removed_at ?? "",
    window_start: iso(w.start),
    window_end: iso(w.end),
    texts,
    channels_used,
    fallback,
    text_status,
    calls,
    call_status,
    picked_up,
    not_reached_alert,
    replies,
    confirmation,
    ptp_date,
    escalation,
    escalation_status,
    balance_at_approval: then,
    balance_now: nowBal,
    collected,
    paid_invoices,
    outcome,
  };
}

export interface BatchSummary {
  clients: number;
  removed: number;
  texted: number;
  called: number;
  picked_up: number;
  replied: number;
  promised: number;
  escalated: number;
  paid: number;
  collected: number | null;
}
export function summarizeOutcomes(rows: ClientOutcome[]): BatchSummary {
  const known = rows.filter((r) => r.collected != null);
  return {
    clients: rows.length,
    removed: rows.filter((r) => r.removed_at).length,
    texted: rows.filter((r) => r.channels_used.length).length,
    called: rows.filter((r) => r.calls.length).length,
    picked_up: rows.filter((r) => r.picked_up === "Yes").length,
    replied: rows.filter((r) => r.replies.length).length,
    promised: rows.filter((r) => r.ptp_date).length,
    escalated: rows.filter((r) => r.escalation).length,
    paid: rows.filter((r) => r.outcome === "Fully paid" || r.outcome.startsWith("Partly paid"))
      .length,
    collected: known.length ? r2(known.reduce((t, r) => t + (r.collected ?? 0), 0)) : null,
  };
}

// ------------------------------------------------------------------------------------------- Excel rows
/** A cell for the Excel writer: text, number, or a date (YYYY-MM-DD). */
export type Cell = string | number | { date: string } | null;

/** The 22 columns of the existing AR report (workflow 25_Call_Run_Report), unchanged and in the same order. */
export const AR_COLUMNS = [
  "SALES PERSON",
  "AR OWNER",
  "SEGMENT",
  "CUSTOMER",
  "PARENT ACCOUNT",
  "INVOICE NO.",
  "DATE",
  "TRANSACTION TYPE",
  "DUE DATE",
  "AMOUNT",
  "OPEN BALANCE",
  "STATUS",
  "CURRENT",
  "1-30 DAYS",
  "31-60 DAYS",
  "61-90 DAYS",
  "OVER 90 DAYS",
  "REMARKS FROM LAST WEEK",
  "CURRENT REMARKS",
  "REMARKS",
  "PROMISE DATE",
  "ESCALATION",
];
/** Added for batch tracking. */
export const BATCH_COLUMNS = [
  "APPROVAL BATCH",
  "APPROVED BY",
  "CHANNELS USED",
  "FALLBACK CHANNEL",
  "TEXT STATUS",
  "CALLS PLACED",
  "CALL STATUS",
  "CALL PICKED UP",
  "CUSTOMER RESPONDED",
  "CUSTOMER RESPONSE",
  "CUSTOMER CONFIRMATION",
  "ESCALATION STATUS",
  "BALANCE AT APPROVAL",
  "BALANCE NOW",
  "COLLECTED SINCE APPROVAL",
  "COLLECTION OUTCOME",
];

const manilaDate = (ms: number) => new Date(ms + MANILA).toISOString().slice(0, 10);
const mmddyy = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + MANILA);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCFullYear()).slice(2)}`;
};
export function batchLabel(b: Batch): string {
  const d = new Date(new Date(b.approved_at).getTime() + MANILA);
  const h = d.getUTCHours();
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "SENT SOA VIA EMAIL (11.12.26); SENT VIBER REMINDER (11.12.26); CALLED (11.12.26); PROMISED 11.13.26" (as report 25). */
export function currentRemarks(o: ClientOutcome): string {
  const lastOk = (ch: string) => [...o.texts].reverse().find((t) => t.ok && t.channel === ch);
  const parts: string[] = [];
  const email = lastOk("EMAIL");
  if (email) parts.push(`SENT SOA VIA EMAIL (${mmddyy(email.at)})`);
  for (const ch of ["SMS", "VIBER", "WHATSAPP"]) {
    const t = lastOk(ch);
    if (t) parts.push(`SENT ${ch} REMINDER (${mmddyy(t.at)})`);
  }
  if (o.calls.length) parts.push(`CALLED (${mmddyy(o.calls[o.calls.length - 1]!.at)})`);
  if (o.ptp_date)
    parts.push(
      `PROMISED ${o.ptp_date.slice(5, 7)}.${o.ptp_date.slice(8, 10)}.${o.ptp_date.slice(2, 4)}`,
    );
  return parts.join("; ");
}

/**
 * The report sheet: header block, then one row per open invoice of the batch's clients (the 22 AR columns,
 * same rules as report 25) plus the batch columns. Invoices paid since the approval are listed as PAID.
 */
export function batchReportRows(a: {
  batch: Batch;
  outcomes: ClientOutcome[];
  clients: Map<string, Row>;
  weeklyRemarks: Row[];
  now?: number;
}): Cell[][] {
  const now = a.now ?? Date.now();
  const today = manilaDate(now);
  const todayMs = Date.parse(today + "T00:00:00Z");
  const label = batchLabel(a.batch);
  const rows: Cell[][] = [];
  let total = 0;
  let overdue = 0;
  let current = 0;
  for (const o of a.outcomes) {
    const c =
      a.clients.get(o.client_id) ??
      [...a.clients.values()].find((x) => companyKey(x["client_id"]) === companyKey(o.client_id));
    const responded = o.replies.length
      ? `Yes (${[...new Set(o.replies.map((r) => r.channel))].join(", ")})`
      : "No";
    const lastReply = o.replies[o.replies.length - 1];
    const promActive = !!o.ptp_date && o.ptp_date >= today;
    const remarks = currentRemarks(o);
    const channel = c && s(c["email"]) ? "EMAIL" : c && s(c["phone"]) ? "SMS" : "";
    const followUp = o.escalation
      ? "AR TO FOLLOW UP (ESCALATED)"
      : promActive
        ? `FOLLOW UP ON PROMISE (${o.ptp_date.slice(5, 7)}.${o.ptp_date.slice(8, 10)}.${o.ptp_date.slice(2, 4)})`
        : channel
          ? `FOLLOW UP VIA ${channel}`
          : "FOLLOW UP";
    const extra = (): Cell[] => [
      label,
      a.batch.approved_by,
      o.channels_used.join(", "),
      o.fallback,
      o.text_status,
      o.calls.length,
      o.call_status,
      o.picked_up,
      responded,
      lastReply ? `${lastReply.channel}: ${lastReply.text}` : "",
      o.confirmation,
      o.escalation_status,
      o.balance_at_approval,
      o.balance_now,
      o.collected,
      o.outcome,
    ];
    const open = openInvoices(c);
    for (const { no, inv, branch } of open) {
      const bal = num(inv["balance"]);
      const isCurrent = s(inv["status"]).toUpperCase() === "CURRENT";
      const due = s(inv["due_date"]).slice(0, 10);
      const days = due ? Math.floor((todayMs - Date.parse(due + "T00:00:00Z")) / 86400000) : 0;
      const bucket = isCurrent ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
      const aging: Cell[] = [null, null, null, null, null];
      aging[bucket] = bal;
      total += bal;
      if (isCurrent) current += bal;
      else overdue += bal;
      const lastWeek = a.weeklyRemarks
        .filter(
          (r) =>
            companyKey(r["client_id"]) === companyKey(o.client_id) &&
            s(r["invoice_number"]) === no &&
            s(r["as_of"]) < today,
        )
        .sort((x, y) => s(y["as_of"]).localeCompare(s(x["as_of"])))[0];
      const invDate = s(inv["invoice_date"]).slice(0, 10);
      rows.push([
        s(inv["salesperson_name"]) || s(branch["sales_person"]) || s(c?.["sales_person"]),
        s(c?.["ar_owner"]),
        s(c?.["segment"]),
        s(branch["branch_name"]) || s(c?.["client_name"]) || o.client_name,
        s(c?.["parent_name"]),
        no,
        invDate ? { date: invDate } : "",
        "Invoice",
        due ? { date: due } : "",
        num(inv["amount"]) || bal,
        bal,
        isCurrent ? "CURRENT" : "OVERDUE",
        ...aging,
        lastWeek ? s(lastWeek["remarks"]) : "",
        isCurrent ? "NOT YET DUE" : remarks || "NO ACTION THIS WEEK",
        followUp,
        promActive ? { date: o.ptp_date } : "",
        o.escalation,
        ...extra(),
      ]);
    }
    // Invoices open at approval and paid since: listed so the batch keeps every client.
    const snap = new Map(
      (a.batch.clients.find((b) => b.client_id === o.client_id)?.invoices ?? []).map((x) => [
        x[0],
        x,
      ]),
    );
    for (const no of o.paid_invoices) {
      const x = snap.get(no)!;
      rows.push([
        s(c?.["sales_person"]),
        s(c?.["ar_owner"]),
        s(c?.["segment"]),
        o.client_name,
        s(c?.["parent_name"]),
        no,
        "",
        "Invoice",
        "",
        x[1],
        0,
        "PAID SINCE APPROVAL",
        null,
        null,
        null,
        null,
        null,
        "",
        remarks || "",
        "PAID",
        "",
        o.escalation,
        ...extra(),
      ]);
    }
    if (!open.length && !o.paid_invoices.length) {
      rows.push([
        s(c?.["sales_person"]),
        s(c?.["ar_owner"]),
        s(c?.["segment"]),
        o.client_name,
        s(c?.["parent_name"]),
        "",
        "",
        "",
        "",
        null,
        0,
        c ? "NO OPEN INVOICES" : "CLIENT NOT IN ZOHO DATA",
        null,
        null,
        null,
        null,
        null,
        "",
        remarks || "",
        followUp,
        o.ptp_date ? { date: o.ptp_date } : "",
        o.escalation,
        ...extra(),
      ]);
    }
  }
  rows.sort((x, y) => s(x[3]).localeCompare(s(y[3])) || s(x[5]).localeCompare(s(y[5])));
  const sum = summarizeOutcomes(a.outcomes);
  const asOf = new Date(now + MANILA);
  const months = [
    "JANUARY",
    "FEBRUARY",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUGUST",
    "SEPTEMBER",
    "OCTOBER",
    "NOVEMBER",
    "DECEMBER",
  ];
  return [
    [
      `APPROVAL BATCH: ${label.toUpperCase()} (APPROVED BY ${a.batch.approved_by.toUpperCase() || "UNKNOWN"}, ${a.outcomes.length} CLIENTS)`,
    ],
    [
      `AS OF ${months[asOf.getUTCMonth()]} ${String(asOf.getUTCDate()).padStart(2, "0")}, ${asOf.getUTCFullYear()}`,
    ],
    ["TOTAL", r2(total)],
    ["SUBTOTAL (OVERDUE)", r2(overdue)],
    ["CURRENT", r2(current)],
    [
      "COLLECTED SINCE APPROVAL",
      sum.collected ?? "not known (balances at approval were not recorded for this batch)",
    ],
    [],
    [...AR_COLUMNS, ...BATCH_COLUMNS],
    ...rows,
  ];
}

/** Second sheet: one row per client of the batch, with every action and its time. */
export const CLIENT_COLUMNS = [
  "CUSTOMER",
  "APPROVED AT",
  "APPROVED BY",
  "TRACKED UNTIL",
  "CHANNELS USED",
  "TEXTS (TIME, CHANNEL, RESULT)",
  "FALLBACK CHANNEL",
  "CALLS (TIME, RESULT)",
  "CALL PICKED UP",
  "NOT REACHED BY PHONE",
  "CUSTOMER REPLIES",
  "CUSTOMER CONFIRMATION",
  "PROMISE TO PAY",
  "ESCALATION",
  "ESCALATION STATUS",
  "BALANCE AT APPROVAL",
  "BALANCE NOW",
  "COLLECTED SINCE APPROVAL",
  "INVOICES PAID SINCE APPROVAL",
  "COLLECTION OUTCOME",
];
export function batchClientRows(batch: Batch, outcomes: ClientOutcome[]): Cell[][] {
  const t = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + MANILA);
    const h = d.getUTCHours();
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  return [
    CLIENT_COLUMNS,
    ...outcomes.map((o) => [
      o.client_name,
      batchLabel(batch),
      batch.approved_by,
      o.removed_at ? `Approval removed ${t(o.removed_at)}` : t(o.window_end),
      o.channels_used.join(", "),
      o.texts
        .map(
          (x) =>
            `${t(x.at)} ${x.channel}${x.fallback ? " (fallback)" : ""}: ${x.ok ? "sent" : `failed ${x.error}`}`,
        )
        .join("; "),
      o.fallback,
      o.calls.map((c) => `${t(c.at)}: ${c.result}`).join("; "),
      o.picked_up,
      o.not_reached_alert ? "Yes (call and retry unanswered)" : "",
      o.replies.map((r) => `${t(r.at)} ${r.channel}: ${r.text}`).join(" | "),
      o.confirmation,
      o.ptp_date ? { date: o.ptp_date } : "",
      o.escalation,
      o.escalation_status,
      o.balance_at_approval,
      o.balance_now,
      o.collected,
      o.paid_invoices.join(", "),
      o.outcome,
    ]),
  ];
}
