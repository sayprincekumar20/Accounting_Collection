// Contacts to Fix: clients whose reminder email bounced. The bounces are recorded by the n8n workflow
// 18_Email_Bounce_Watcher (table email_bounces). A bounce only counts while the client's CURRENT email is still the
// address that bounced, so the entry disappears by itself once the address is corrected in Zoho.
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/** Latest bounce per client within the last `days` days. */
export function latestBounces(rows: Row[], now = Date.now(), days = 60): Map<string, Row> {
  const out = new Map<string, Row>();
  const at = (r: Row) => new Date(s(r["bounced_at"])).getTime() || 0;
  for (const r of rows) {
    const id = s(r["client_id"]);
    const t = at(r);
    if (!id || !t || t < now - days * 86400000) continue;
    const prev = out.get(id);
    if (!prev || t > at(prev)) out.set(id, r);
  }
  return out;
}

/** The "Contacts to Fix" issue text for a client, or null when its current email is not the one that bounced. */
export function bounceIssue(email: string, bounce: Row | undefined): string | null {
  if (!bounce) return null;
  const addr = s(bounce["address"]).trim().toLowerCase();
  if (!addr || addr !== email.trim().toLowerCase()) return null;
  const day = s(bounce["bounced_at"]).slice(0, 10);
  return `Email bounced: ${s(bounce["reason"]) || "delivery failed"}${day ? ` (${day})` : ""}`;
}
