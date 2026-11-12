// The automatic "Not reached by phone" alert: raised after Grace's call AND the automatic retry both went unanswered.
// It is not a client message, but AR should see it (check the phone number, reach the client another way). It is
// shown in Client escalations while it is recent; older ones stay in the log (and in the client's pop-up).
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export const ALERT_DAYS = 7;

export const isNotReachedReason = (reason: unknown) =>
  /^not reached by phone/i.test(s(reason).trim());

/** True for a "Not reached by phone" alert younger than `days` days. */
export function isRecentNotReachedAlert(e: Row, now = Date.now(), days = ALERT_DAYS): boolean {
  if (!isNotReachedReason(e["reason"])) return false;
  const t = new Date(s(e["timestamp"]) || s(e["createdAt"])).getTime();
  return !!t && t >= now - days * 86400000;
}
