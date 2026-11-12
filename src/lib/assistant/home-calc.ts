// AI assistant home screen: pure calculations (no network), so they can be unit-tested.
// The numbers use the same definitions as the dashboard pages (Contact Approvals, Promises, Escalations).
import { escalationType, type EscalationType } from "@/lib/escalation-type";
import { isNotReachedReason, isRecentNotReachedAlert } from "@/lib/escalation-alerts";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const companyKey = (id: unknown) => s(id).split("___")[0]!.trim().toLowerCase();
const ms = (v: unknown) => new Date(s(v)).getTime() || 0;
export const manilaDay = (d: Date) =>
  new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);

/** The fields of a Contact Approvals item that the home screen needs. */
export interface HomeClient {
  client_id: string;
  overdue: number;
  approved: boolean;
  internal_account: boolean;
  sales_team: boolean | null;
  multibranch: boolean;
  promise_until: string;
  ar_handoff_until: string;
}

/** A client-related escalation: not a system notification; "not reached by phone" alerts only while recent. */
export function isClientEscalation(e: Row): boolean {
  const ch = s(e["channel"]).toUpperCase();
  if (ch.startsWith("SYSTEM") || ch === "VOICE_CALLBACK") return false;
  if (s(e["client_id"]).toUpperCase().startsWith("SYSTEM")) return false;
  if (isNotReachedReason(e["reason"])) return isRecentNotReachedAlert(e);
  return true;
}

export const isOpenEscalation = (e: Row) =>
  isClientEscalation(e) && (s(e["status"]).toUpperCase() || "OPEN") !== "DONE";

export function openEscalations(rows: Row[]): { count: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  let count = 0;
  for (const e of rows) {
    if (!isOpenEscalation(e)) continue;
    count++;
    const t: EscalationType | "Not reached" = isNotReachedReason(e["reason"])
      ? "Not reached"
      : escalationType(e["reason"]);
    byType[t] = (byType[t] || 0) + 1;
  }
  return { count, byType };
}

/** Overdue accounts in the collection list (not internal accounts, not owners outside the Sales Team). */
export function overdueAccounts(items: HomeClient[]): number {
  return items.filter((i) => i.overdue > 0 && !i.internal_account && i.sales_team !== false).length;
}

/** Overdue clients that Accounting has not approved yet this cycle and that automation could actually contact. */
export function waitingApproval(items: HomeClient[], now = Date.now()): number {
  return items.filter(
    (i) =>
      i.overdue > 0 &&
      !i.approved &&
      !i.internal_account &&
      i.sales_team !== false &&
      !i.multibranch &&
      !(ms(i.promise_until) > now) &&
      !(ms(i.ar_handoff_until) > now),
  ).length;
}

/**
 * Promises (latest per company) that are due today, or whose date has passed while the company still owes
 * money (missed). `balanceByCompany` holds the companies that still have an unpaid balance.
 */
export function promisesDue(
  promises: Row[],
  owing: Set<string>,
  today: string,
): { dueToday: number; missed: number } {
  const latest = new Map<string, Row>();
  const at = (r: Row) => ms(r["timestamp"]) || ms(r["createdAt"]);
  for (const p of promises) {
    const k = companyKey(p["client_id"]);
    if (!k) continue;
    const prev = latest.get(k);
    if (!prev || at(p) > at(prev)) latest.set(k, p);
  }
  let dueToday = 0;
  let missed = 0;
  for (const [k, p] of latest) {
    const d = s(p["promise_date"]).slice(0, 10);
    if (!d) continue;
    if (d === today) dueToday++;
    else if (d < today && owing.has(k)) missed++;
  }
  return { dueToday, missed };
}

export interface HealthEventRow {
  event_key: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  affected: string;
  suggested_fix: string;
  status: string;
  first_seen: string;
  last_seen: string;
  resolved_at: string;
  occurrences: number;
}

const RANK: Record<string, number> = { urgent: 0, warning: 1, info: 2 };

export function openHealth(rows: Row[]): {
  urgent: number;
  warning: number;
  total: number;
  events: HealthEventRow[];
} {
  const events = rows
    .filter((r) => s(r["event_key"]) && s(r["status"]).toLowerCase() === "open")
    .map((r) => ({
      event_key: s(r["event_key"]),
      severity: s(r["severity"]).toLowerCase() || "warning",
      category: s(r["category"]),
      title: s(r["title"]),
      detail: s(r["detail"]),
      affected: s(r["affected"]),
      suggested_fix: s(r["suggested_fix"]),
      status: "open",
      first_seen: s(r["first_seen"]),
      last_seen: s(r["last_seen"]),
      resolved_at: "",
      occurrences: Number(r["occurrences"]) || 0,
    }))
    .sort(
      (a, b) =>
        (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3) || b.last_seen.localeCompare(a.last_seen),
    );
  const urgent = events.filter((e) => e.severity === "urgent").length;
  const warning = events.filter((e) => e.severity === "warning").length;
  return { urgent, warning, total: urgent + warning, events };
}

export interface HomePriority {
  id: string;
  title: string;
  detail: string;
  badge: string;
  tone: "danger" | "warning" | "info" | "ok";
  /** Question sent to the assistant when the card is clicked. */
  prompt?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeEscalationTypes(byType: Record<string, number>): string {
  const names: Record<string, [string, string]> = {
    "Paid claim": ["paid claim", "paid claims"],
    Dispute: ["dispute", "disputes"],
    "Document request": ["document request", "document requests"],
    Callback: ["callback request", "callback requests"],
    "Contact change": ["contact change", "contact changes"],
    "Wrong contact": ["wrong contact", "wrong contacts"],
    "Not reached": ["not-reached alert", "not-reached alerts"],
    Other: ["other case", "other cases"],
  };
  return Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => plural(n, ...(names[t] ?? [t.toLowerCase(), t.toLowerCase()])))
    .join(", ");
}

export function buildPriorities(input: {
  escalations: { count: number; byType: Record<string, number> };
  promises: { dueToday: number; missed: number };
  waitingApproval: number;
  health: { urgent: number; warning: number; total: number; events: { title: string }[] };
}): HomePriority[] {
  const out: HomePriority[] = [];
  const { escalations: e, promises: p, health: h } = input;
  if (h.urgent > 0)
    out.push({
      id: "health",
      title: "Workflow problems need attention",
      detail: h.events
        .slice(0, 2)
        .map((x) => x.title)
        .join(" · "),
      badge: plural(h.urgent, "urgent", "urgent"),
      tone: "danger",
      prompt: "Check the workflows and tell me what needs attention and what to do.",
    });
  if (e.count > 0)
    out.push({
      id: "escalations",
      title: "Review escalated customers",
      detail: describeEscalationTypes(e.byType) + " need AR attention.",
      badge: `${e.count} pending`,
      tone: "danger",
      prompt:
        "Analyse the open escalations: group them by type and tell me which need AR action first.",
    });
  if (p.dueToday + p.missed > 0)
    out.push({
      id: "promises",
      title: "Payment promises",
      detail: [
        p.dueToday ? `${p.dueToday} due today` : "",
        p.missed ? `${p.missed} past the promised date and still unpaid` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      badge: `${p.dueToday + p.missed} due`,
      tone: "warning",
      prompt: "Show the promises that are due today or missed, with the balance still owed.",
    });
  if (input.waitingApproval > 0)
    out.push({
      id: "approvals",
      title: "Approvals waiting",
      detail: "Overdue clients not yet approved this cycle (Wednesday to Tuesday).",
      badge: `${input.waitingApproval} to approve`,
      tone: "info",
      prompt: "Show the clients waiting for approval this cycle, biggest overdue first.",
    });
  if (h.urgent === 0 && h.warning > 0)
    out.push({
      id: "health",
      title: "Workflow warnings",
      detail: h.events
        .slice(0, 2)
        .map((x) => x.title)
        .join(" · "),
      badge: plural(h.warning, "warning", "warnings"),
      tone: "warning",
      prompt: "Check the workflows and tell me what needs attention and what to do.",
    });
  if (!out.length)
    out.push({
      id: "clear",
      title: "Nothing urgent right now",
      detail: "No open escalations, due promises, approvals waiting or workflow problems.",
      badge: "All clear",
      tone: "ok",
    });
  return out;
}
