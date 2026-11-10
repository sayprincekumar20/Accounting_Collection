// Escalation type from its reason text (AI agents / Grace write free text): used for the escalation card,
// the Overview breakdown and filters.
export const ESCALATION_TYPES = [
  "Paid claim",
  "Dispute",
  "Document request",
  "Callback",
  "Contact change",
  "Wrong contact",
  "Other",
] as const;
export type EscalationType = (typeof ESCALATION_TYPES)[number];

export function escalationType(reason: unknown): EscalationType {
  const r = String(reason ?? "").toLowerCase();
  if (/wrong (number|person|recipient|company)|not (our|the) client|wrong_recipient/.test(r))
    return "Wrong contact";
  if (
    /already paid|claims? (already )?paid|paid (already|in full)|partial(ly)? paid|partial payment|bayad na|deposit slip|proof of payment/.test(
      r,
    )
  )
    return "Paid claim";
  if (
    /dispute|wrong (amount|balance)|incorrect|mali|discrepanc|not (ours|correct)|overcharg|credit memo|return/.test(
      r,
    )
  )
    return "Dispute";
  if (
    /soa|statement|invoice copy|document|copy of|\bpo\b|po number|delivery receipt|\bdr\b|official receipt|\bor\b|request/.test(
      r,
    )
  )
    return "Document request";
  if (/call ?back|callback|real person|talk to|call me|tawag/.test(r)) return "Callback";
  if (
    /contact (change|update)|new (number|email|contact)|update (their )?contact|contact_change/.test(
      r,
    )
  )
    return "Contact change";
  return "Other";
}

/** Hours an escalation has been open (until handled when DONE). */
export function escalationAgeHours(
  recordedAt: string,
  status: string,
  handledAt?: string,
  now = Date.now(),
): number {
  const start = new Date(recordedAt).getTime() || now;
  const end = status === "DONE" && handledAt ? new Date(handledAt).getTime() || now : now;
  return Math.max(0, (end - start) / 3600000);
}
