import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { companyKey, cycleStart } from "@/lib/client-activity";
import { isNotReachedAlert } from "@/lib/authorship";
import { ESCALATION_TYPES, escalationAgeHours, escalationType } from "@/lib/escalation-type";

// AR management summary for the Overview page: aging with the promised part, promise pipeline,
// escalations by type, this cycle's contact funnel and the top overdue clients.
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const manilaDay = (t: number) => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
const at = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;

export const BUCKETS = ["Current", "1-30 days", "31-60 days", "61-90 days", "90+ days"] as const;
export function bucketOf(
  dueIso: string,
  status: string,
  todayIso: string,
): (typeof BUCKETS)[number] {
  if (status === "CURRENT" || !dueIso) return "Current";
  const days = Math.floor(
    (new Date(todayIso).getTime() - new Date(dueIso.slice(0, 10)).getTime()) / 86400000,
  );
  if (days <= 0) return "Current";
  if (days <= 30) return "1-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

export function computeInsights(
  clients: Row[],
  promises: Row[],
  escalations: Row[],
  approvals: Row[],
  logs: Row[],
  convos: Row[],
  now = Date.now(),
) {
  const today = manilaDay(now);
  const active = clients.filter(
    (c) =>
      s(c["status"]).toUpperCase() !== "INACTIVE" &&
      s(c["client_id"]) &&
      n(c["collection_amount"]) > 0,
  );
  // latest promise per company
  const latest = new Map<string, Row>();
  for (const p of promises) {
    const k = companyKey(p["client_id"]);
    if (!latest.has(k) || at(p) > at(latest.get(k)!)) latest.set(k, p);
  }
  const promisedCo = new Set(
    [...latest.entries()]
      .filter(([, p]) => s(p["promise_date"]).slice(0, 10) >= today)
      .map(([k]) => k),
  );

  // aging
  const aging = BUCKETS.map((b) => ({ bucket: b, amount: 0, promised: 0, invoices: 0 }));
  const top: {
    client_id: string;
    client_name: string;
    overdue: number;
    total: number;
    oldest_days: number;
    promised: boolean;
  }[] = [];
  for (const c of active) {
    const k = companyKey(c["client_id"]);
    let oldest = 0;
    try {
      for (const b of JSON.parse(s(c["branches_data"]) || "[]") as Row[]) {
        let inv: Row[] = [];
        try {
          inv = JSON.parse(s(b["invoice_details"]) || "[]");
        } catch {
          inv = [];
        }
        for (const i of inv) {
          const bal = n(i["balance"]);
          if (bal <= 0) continue;
          const bk = bucketOf(s(i["due_date"]), s(i["status"]).toUpperCase(), today);
          const row = aging.find((a) => a.bucket === bk)!;
          row.amount += bal;
          row.invoices += 1;
          if (promisedCo.has(k)) row.promised += bal;
          if (bk !== "Current")
            oldest = Math.max(
              oldest,
              Math.floor(
                (new Date(today).getTime() - new Date(s(i["due_date"]).slice(0, 10)).getTime()) /
                  86400000,
              ),
            );
        }
      }
    } catch {
      // unreadable invoice data
    }
    if (n(c["overdue_total"]) > 0)
      top.push({
        client_id: s(c["client_id"]),
        client_name: s(c["client_name"]),
        overdue: n(c["overdue_total"]),
        total: n(c["collection_amount"]),
        oldest_days: oldest,
        promised: promisedCo.has(k),
      });
  }

  // promise pipeline (Monday-Sunday weeks, Manila)
  const wd = new Date(now + 8 * 3600000).getUTCDay() || 7;
  const weekStart = manilaDay(now - (wd - 1) * 86400000);
  const nextWeekStart = manilaDay(now + (8 - wd) * 86400000);
  const weekAfter = manilaDay(now + (15 - wd) * 86400000);
  const totalByCo = new Map(
    active.map((c) => [companyKey(c["client_id"]), n(c["collection_amount"])]),
  );
  const pipeline = {
    this_week: { clients: 0, amount: 0 },
    next_week: { clients: 0, amount: 0 },
    kept: 0,
    broken: 0,
  };
  for (const [k, p] of latest) {
    const d = s(p["promise_date"]).slice(0, 10);
    const amt = totalByCo.get(k) ?? 0;
    if (d >= weekStart && d < nextWeekStart && d >= today) {
      pipeline.this_week.clients++;
      pipeline.this_week.amount += amt;
    } else if (d >= nextWeekStart && d < weekAfter) {
      pipeline.next_week.clients++;
      pipeline.next_week.amount += amt;
    }
    if (d < today && d >= manilaDay(now - 30 * 86400000)) {
      if (amt > 0) pipeline.broken++;
      else pipeline.kept++;
    }
  }

  // escalations by type
  const esc = escalations.filter(
    (e) =>
      s(e["channel"]).toUpperCase() !== "SYSTEM" &&
      !isNotReachedAlert(e["reason"]) &&
      s(e["entry_id"]),
  );
  const byType = ESCALATION_TYPES.map((t) => ({
    type: t,
    open: 0,
    in_progress: 0,
    done: 0,
    avg_open_hours: 0,
  }));
  const openHours = new Map<string, number[]>();
  for (const e of esc) {
    const t = escalationType(e["reason"]);
    const st = s(e["status"]).toUpperCase() || "OPEN";
    const row = byType.find((x) => x.type === t)!;
    if (st === "DONE") row.done++;
    else if (st === "IN_PROGRESS") row.in_progress++;
    else row.open++;
    if (st !== "DONE") {
      const list = openHours.get(t) ?? [];
      list.push(
        escalationAgeHours(s(e["timestamp"]) || s(e["createdAt"]), st, s(e["handled_at"]), now),
      );
      openHours.set(t, list);
    }
  }
  for (const row of byType) {
    const list = openHours.get(row.type) ?? [];
    row.avg_open_hours = list.length
      ? Math.round(list.reduce((a, b) => a + b, 0) / list.length)
      : 0;
  }

  // contact funnel this cycle
  const cs = cycleStart(new Date(now)).getTime();
  const approved = new Set(
    approvals
      .filter(
        (a) =>
          (a["approved"] === true || s(a["approved"]) === "true") &&
          (new Date(s(a["approved_at"])).getTime() || 0) >= cs,
      )
      .map((a) => s(a["company_key"]).toLowerCase()),
  );
  const since = (r: Row) => at(r) >= cs;
  const coSet = (rows: Row[]) => new Set(rows.map((r) => companyKey(r["client_id"])));
  const texted = coSet(
    logs.filter(
      (l) =>
        since(l) &&
        s(l["event_type"]).toUpperCase() === "SEND_SUCCESS" &&
        s(l["channel"]).toUpperCase() !== "VOICE",
    ),
  );
  const called = coSet(
    logs.filter(
      (l) =>
        since(l) &&
        s(l["channel"]).toUpperCase() === "VOICE" &&
        s(l["event_type"]).toUpperCase() === "CALL_INITIATED",
    ),
  );
  const answered = coSet(
    convos.filter(
      (c) =>
        since(c) &&
        s(c["channel"]).toUpperCase() === "VOICE" &&
        !/no transcript available/i.test(s(c["message_text"])),
    ),
  );
  const promisedCycle = coSet(promises.filter(since));
  const funnel = [
    { step: "Approved", clients: approved.size },
    { step: "Texted", clients: texted.size },
    { step: "Called", clients: called.size },
    { step: "Answered", clients: answered.size },
    { step: "Promised", clients: promisedCycle.size },
  ];

  return {
    today,
    aging: aging.map((a) => ({ ...a, amount: r2(a.amount), promised: r2(a.promised) })),
    pipeline: {
      ...pipeline,
      this_week: { ...pipeline.this_week, amount: r2(pipeline.this_week.amount) },
      next_week: { ...pipeline.next_week, amount: r2(pipeline.next_week.amount) },
    },
    escalations: byType,
    funnel,
    top_overdue: top.sort((a, b) => b.overdue - a.overdue).slice(0, 10),
  };
}

export const Route = createFileRoute("/api/insights")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [clients, promises, escalations, approvals, logs, convos] = await Promise.all([
            fetchAllDataTableRows<Row>("rJpqXxmxhqJnlLrJ"),
            fetchAllDataTableRows<Row>("JyGFOqTqI3QXHJbb").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("ANfkZZDIrDuC4RjK").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("3IvKKI4AwrBlDeOo").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("a32Z5oGcNi0xzefb").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("2WtfkEaHiBSzgItW").catch(() => [] as Row[]),
          ]);
          return json(computeInsights(clients, promises, escalations, approvals, logs, convos));
        } catch (err) {
          console.error("[insights] error:", err);
          return json({ error: "Failed to load insights" }, 500);
        }
      },
    },
  },
});
