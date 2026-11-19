// The automatic "Not reached by phone" alert: raised after Grace's call AND the automatic retry both went unanswered.
// It is NOT an escalation (an escalation is something the client raised that the agents could not handle): it is
// kept out of the Escalations module and shown as its own "Not reached" status in the Voice log.
const s = (v: unknown) => (v == null ? "" : String(v));

export const isNotReachedReason = (reason: unknown) =>
  /^not reached by phone/i.test(s(reason).trim());

/**
 * A system notification, not a customer escalation: workflow failures, automation errors, run results,
 * cycle close-outs, technical alerts. Written with channel SYSTEM / SYSTEM_ERROR / SYSTEM_..., or with a
 * client id starting with SYSTEM, or worded as a workflow failure. Customer escalations (disputes, payment
 * issues, unresolved conversations, callback requests) are everything else.
 */
const SYSTEM_REASON =
  /^(workflow failed|\[system\]|system( alert| error)?:|automation error|integration error)/i;
export function isSystemRow(e: Record<string, unknown>): boolean {
  if (s(e["channel"]).trim().toUpperCase().startsWith("SYSTEM")) return true;
  if (s(e["client_id"]).trim().toUpperCase().startsWith("SYSTEM")) return true;
  return SYSTEM_REASON.test(s(e["reason"]).trim());
}
