// The automatic "Not reached by phone" alert: raised after Grace's call AND the automatic retry both went unanswered.
// It is NOT an escalation (an escalation is something the client raised that the agents could not handle): it is
// kept out of the Escalations module and shown as its own "Not reached" status in the Voice log.
const s = (v: unknown) => (v == null ? "" : String(v));

export const isNotReachedReason = (reason: unknown) =>
  /^not reached by phone/i.test(s(reason).trim());
