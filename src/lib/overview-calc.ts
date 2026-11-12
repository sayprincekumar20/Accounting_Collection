// Overview cards: what is really waiting in the queue, and promises made on a specific call. Pure, unit-tested.
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/** Queue rows split by meaning: still to be sent, already sent, skipped by a rule (stale rows are ignored). */
export function queueBreakdown(rows: Row[]) {
  const out = { waiting: 0, waitingAmount: 0, sent: 0, skipped: 0 };
  for (const r of rows) {
    const st = s(r["queue_status"]).toUpperCase();
    if (!st || st === "STALE") continue;
    if (st === "SENT") out.sent++;
    else if (st.startsWith("SKIPPED")) out.skipped++;
    else {
      out.waiting++;
      out.waitingAmount += Number(r["collection_amount"] || 0);
    }
  }
  return out;
}

/**
 * The promise to pay made ON this call: recorded for the same client on the voice channel between the start of
 * the call and 15 minutes after it ended (the promise is saved during the call or by the end-of-call report).
 */
export function promiseForCall<
  T extends { client_id: string; channel: string; recorded_at: string },
>(
  promises: T[],
  call: { client_id: string; startedAt: string; endedAt?: string | null },
): T | undefined {
  const start = new Date(call.startedAt).getTime();
  if (!start || !call.client_id) return undefined;
  const end = new Date(call.endedAt || call.startedAt).getTime() || start;
  return promises.find((p) => {
    if (p.client_id !== call.client_id || s(p.channel).toLowerCase() !== "voice") return false;
    const t = new Date(p.recorded_at).getTime();
    return !!t && t >= start - 60000 && t <= end + 15 * 60000;
  });
}
