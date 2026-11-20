// Actions executed through the n8n backend, shared by the dashboard buttons and the AI assistant.
//  - approveClients: Contact Approvals (28): approval valid for the current cycle (Wed-Tue).
//  - contactClients: the contact command (21 -> 22 / 26): Zoho refresh, PDF, text, call, with all the usual
//    checks (approval, Sales Team, promise, 5+ branches, cooldown). Replaces the Zoho Cliq /call command:
//    Cliq no longer knows this key.
//  - sendReminderViaN8n: one reminder from the assistant's reminder composer (25_Dashboard_Reminder).
import { requireSecret } from "@/lib/env";

// Keys are server secrets (N8N_APPROVAL_SECRET, N8N_CONTACT_SECRET), never in the code.
const N8N = "https://rareglobalfood.app.n8n.cloud/webhook";

export interface ApprovalItem {
  client_id: string;
  client_name?: string;
  approved: boolean;
  note?: string;
  allow_multibranch?: boolean;
}

export async function approveClients(
  approvedBy: string,
  items: ApprovalItem[],
): Promise<{ ok: boolean; saved: number }> {
  const res = await fetch(`${N8N}/contact-approval-update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-approval-secret": await requireSecret("N8N_APPROVAL_SECRET"),
    },
    body: JSON.stringify({ approved_by: approvedBy.slice(0, 80), items: items.slice(0, 500) }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; saved?: number };
  if (!res.ok || out.ok === false) throw new Error(`Saving approvals failed (${res.status})`);
  return { ok: true, saved: Number(out.saved ?? items.length) };
}

/**
 * Runs the contact process for these client names; returns the plan text. The n8n command accepts up to 300
 * names and runs lists over 20 in batches of 20 by itself (one AR report for the whole list). Calls from the
 * dashboard buttons and the assistant tool keep the default of 20; the contact-list flow passes a higher limit.
 */
export async function contactClients(
  requestedBy: string,
  names: string[],
  force = false,
  max = 20,
): Promise<{ reply: string }> {
  const list = names
    .map((n) => String(n || "").trim())
    .filter(Boolean)
    .slice(0, Math.min(Math.max(1, max), 300));
  if (!list.length) throw new Error("No client names");
  const res = await fetch(`${N8N}/cliq-call-command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cliq-secret": await requireSecret("N8N_CONTACT_SECRET"),
    },
    body: JSON.stringify({
      text: (force ? "force\n" : "") + list.join("\n"),
      user_name: requestedBy.slice(0, 80) + " (dashboard)",
      user_id: "",
      user_email: "",
      chat_id: "CT_1424577087845262897_826674771",
      chat_type: "channel",
      chat_title: "Dashboard",
      channel_unique_name: "sales",
      source: "dashboard",
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { reply?: string };
  if (!res.ok) throw new Error(`Starting the contact failed (${res.status})`);
  return { reply: String(out.reply || "") };
}

/**
 * "Call again": ONE call with Grace to this client right now, no text (n8n 23_Call_Now -> 13 voice workflow).
 * n8n re-checks the client (exists, active, valid PH mobile number). Same key as the contact command.
 */
export async function callNow(
  requestedBy: string,
  clientId: string,
  dryRun = false,
): Promise<{ ok: boolean; reply: string }> {
  const res = await fetch(`${N8N}/call-now`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cliq-secret": await requireSecret("N8N_CONTACT_SECRET"),
    },
    body: JSON.stringify({
      client_id: clientId,
      requested_by: requestedBy.slice(0, 80) + " (dashboard)",
      dry_run: dryRun,
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; reply?: string };
  if (!res.ok) throw new Error(`Starting the call failed (${res.status})`);
  return { ok: out.ok === true, reply: String(out.reply || "") };
}

/**
 * Reminder composer (AI assistant): ONE reminder on one channel to one client, after the AR team edited (or
 * kept) the approved template and confirmed. n8n workflow 25_Dashboard_Reminder forwards it to the channel
 * workflow (05 Email / 07 SMS / 04 Viber with the edited text, 06 WhatsApp approved template), which attaches
 * the statement PDF, logs it and counts it like any reminder. Same key as the contact command.
 */
export async function sendReminderViaN8n(input: {
  requestedBy: string;
  clientId: string;
  channel: string;
  subject: string;
  body: string;
  dryRun?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  const secret = await requireSecret("N8N_CONTACT_SECRET");
  const res = await fetch(`${N8N}/dashboard-reminder`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cliq-secret": secret },
    body: JSON.stringify({
      client_id: input.clientId,
      channel: input.channel,
      subject: input.subject,
      body: input.body,
      requested_by: input.requestedBy,
      dry_run: !!input.dryRun,
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok && res.status !== 200)
    return { ok: false, message: out.message || `n8n answered ${res.status}` };
  return { ok: !!out.ok, message: String(out.message || (out.ok ? "Sent" : "Not sent")) };
}
