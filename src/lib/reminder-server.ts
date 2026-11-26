// SERVER-ONLY. Reminder composer (AI assistant): the approved template of each channel for one client, the
// rules that decide whether it may be sent, and the send itself (always re-checked here, never trusted from
// the browser).
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { loadMatchClients } from "@/lib/assistant/list-server";
import { outsideOfficeHours } from "@/lib/assistant/list-match";
import { audit, type ActionContext } from "@/lib/assistant/registry";
import { sendReminderViaN8n } from "@/lib/n8n-actions";
import {
  REMINDER_CHANNELS,
  channelAvailability,
  templateFor,
  validateReminder,
  type ReminderChannel,
  type ReminderClient,
  type ReminderDraft,
} from "@/lib/reminder-templates";
import { sentView } from "@/lib/invoice-selection";

type Row = Record<string, unknown>;
const CLIENTS = "rJpqXxmxhqJnlLrJ";
const s = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const day = (v: string) => v.slice(0, 10);

export interface ChannelOption {
  available: boolean;
  reason: string;
  attachment: string;
  editable: boolean;
  template: ReminderDraft;
}
export interface ReminderPreview {
  client: Omit<ReminderClient, "invoice_statuses" | "pdf_file_id">;
  /** Why this client can never be sent a reminder (empty = it can). */
  blocked: string;
  /** Things the person must acknowledge before sending. */
  warnings: string[];
  channels: Record<ReminderChannel, ChannelOption>;
}

function statusesFromBranches(row: Row): string[] {
  const out: string[] = [];
  try {
    for (const b of JSON.parse(s(row["branches_data"]) || "[]") as Row[])
      for (const inv of JSON.parse(s(b["invoice_details"]) || "[]") as Row[])
        if (num(inv["balance"]) > 0) out.push(s(inv["status"]).toUpperCase());
  } catch {
    // no invoice detail: counts unknown
  }
  return out;
}

export async function reminderPreview(
  clientId: string,
  now = Date.now(),
): Promise<ReminderPreview | null> {
  const [rows, { clients }] = await Promise.all([
    fetchAllDataTableRows<Row>(CLIENTS),
    loadMatchClients(),
  ]);
  const row = rows.find((r) => s(r["client_id"]) === clientId);
  if (!row) return null;
  // Invoices unticked at approval are not sent: the reminder uses the ticked ones only (like the automation).
  const sel = row["selection"] ? sentView(row) : null;
  const m = sel ? undefined : clients.find((c) => c.client_id === clientId);
  const rc: ReminderClient = {
    client_id: clientId,
    client_name: s(row["client_name"]),
    contact_person: s(row["contact_person"]),
    email: s(row["email"]).trim(),
    phone: s(row["phone"]).trim(),
    overdue: sel?.overdue ?? m?.overdue ?? num(row["overdue_total"]),
    current: sel?.current ?? m?.current ?? num(row["current_total"]),
    total: sel?.total ?? m?.total ?? num(row["collection_amount"]),
    invoice_statuses:
      sel?.statuses ??
      (m ? m.invoices.map((i) => i.status.toUpperCase()) : statusesFromBranches(row)),
    pdf_file_id: s(row["pdf_file_id"]),
    pdf_generated_date: s(row["pdf_generated_date"]),
  };

  // Hard rules (never sent) and warnings (sent only after the person acknowledges them).
  let blocked = "";
  const warnings: string[] = [];
  if (s(row["status"]).toUpperCase() === "INACTIVE") blocked = "This client is retired (INACTIVE).";
  else if (row["internal_account"] === true || m?.internal_account)
    blocked = "Internal Rare account: never contacted.";
  else if (row["sales_team"] === false || m?.sales_team === false)
    blocked = "The account owner is not in the Sales Team: not contacted.";
  else if (!(rc.overdue > 0)) blocked = "No overdue balance.";
  if (m) {
    if (Date.parse(m.promise_until) > now)
      warnings.push(
        `Payment promise until ${day(m.promise_until)}: automatic reminders are paused.`,
      );
    if (Date.parse(m.ar_handoff_until) > now)
      warnings.push(`AR has taken over this client until ${day(m.ar_handoff_until)}.`);
    if (m.text_this_cycle) warnings.push("Already texted this cycle.");
    if (m.multibranch) warnings.push(`${m.branch_count} branches: AR contacts these on request.`);
    if (!m.approved) warnings.push("Not approved this cycle on Contact Approvals.");
  }
  if (outsideOfficeHours(now))
    warnings.push("Outside office hours (Monday to Friday, 9 AM to 6 PM Manila).");

  const channels = Object.fromEntries(
    REMINDER_CHANNELS.map((ch) => {
      const a = channelAvailability(ch, rc, now);
      return [
        ch,
        {
          ...a,
          editable: ch !== "WHATSAPP",
          template: templateFor(ch, rc, now),
        } satisfies ChannelOption,
      ];
    }),
  ) as Record<ReminderChannel, ChannelOption>;

  const { invoice_statuses: _i, pdf_file_id: _p, ...client } = rc;
  return { client, blocked, warnings, channels };
}

export type SendOutcome =
  | { status: "sent"; message: string }
  | { status: "needs_ack"; warnings: string[] }
  | { status: "refused"; message: string; errors?: string[] }
  | { status: "failed"; message: string };

export async function sendReminder(
  input: {
    clientId: string;
    channel: string;
    subject: string;
    body: string;
    acknowledged: boolean;
  },
  ctx: ActionContext,
): Promise<SendOutcome> {
  const ch = input.channel.toUpperCase() as ReminderChannel;
  if (!REMINDER_CHANNELS.includes(ch)) return { status: "refused", message: "Unknown channel." };
  const p = await reminderPreview(input.clientId);
  if (!p) return { status: "refused", message: "Client not found." };
  if (p.blocked) return { status: "refused", message: p.blocked };
  const opt = p.channels[ch];
  if (!opt.available) return { status: "refused", message: opt.reason };
  // WhatsApp: the approved template is always sent as is, whatever the browser sent.
  const draft: ReminderDraft =
    ch === "WHATSAPP" ? opt.template : { subject: input.subject, body: input.body };
  const errors = validateReminder(ch, draft);
  if (errors.length)
    return { status: "refused", message: "The message does not follow the channel rules.", errors };
  if (p.warnings.length && !input.acknowledged)
    return { status: "needs_ack", warnings: p.warnings };

  const edited =
    ch !== "WHATSAPP" &&
    (draft.body !== opt.template.body ||
      (ch === "EMAIL" && draft.subject !== opt.template.subject));
  const r = await sendReminderViaN8n({
    requestedBy: ctx.userName,
    clientId: input.clientId,
    channel: ch,
    subject: draft.subject,
    body: draft.body,
  });
  await audit(
    ctx,
    "send_reminder",
    "write",
    { client_id: input.clientId, channel: ch, edited, warnings: p.warnings },
    r.ok ? "ok" : "error",
    `${ch} reminder to ${p.client.client_name}${edited ? " (edited)" : " (approved template)"}: ${r.message}`,
  ).catch(() => undefined);
  return r.ok ? { status: "sent", message: r.message } : { status: "failed", message: r.message };
}
