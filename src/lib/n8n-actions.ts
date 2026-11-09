// Actions executed through the n8n backend, shared by the dashboard buttons and the AI assistant.
//  - approveClients: Contact Approvals (28): approval valid for the current cycle (Wed-Tue).
//  - contactClients: the contact command (21 -> 22 / 26): Zoho refresh, PDF, text, call, with all the usual
//    checks (approval, Sales Team, promise, 5+ branches, cooldown). Replaces the Zoho Cliq /call command:
//    Cliq no longer knows this key.
const N8N = "https://rareglobalfood.app.n8n.cloud/webhook";
const APPROVAL_SECRET = "ap_9d3e71c4b2a85f06e1d7c3b9a4f2e58d";
const CONTACT_SECRET = "cc_44cac751af79f8caca264811b0f2fbad8266bf14";

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
    headers: { "Content-Type": "application/json", "x-approval-secret": APPROVAL_SECRET },
    body: JSON.stringify({ approved_by: approvedBy.slice(0, 80), items: items.slice(0, 500) }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; saved?: number };
  if (!res.ok || out.ok === false) throw new Error(`Saving approvals failed (${res.status})`);
  return { ok: true, saved: Number(out.saved ?? items.length) };
}

/** Runs the contact process for these client names (max 20 per call); returns the plan text. */
export async function contactClients(
  requestedBy: string,
  names: string[],
  force = false,
): Promise<{ reply: string }> {
  const list = names
    .map((n) => String(n || "").trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!list.length) throw new Error("No client names");
  const res = await fetch(`${N8N}/cliq-call-command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cliq-secret": CONTACT_SECRET },
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
