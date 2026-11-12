// AI assistant: the registered actions (Phase 1: read-only data tools + dashboard navigation).
// Every tool reads the same n8n data tables as the dashboard pages and returns compact results.
import { z } from "zod";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { buildActivity, companyKey, cycleStart, loadActivityTables } from "@/lib/client-activity";
import { registerAction, type ActionContext } from "./registry";
import { approveClients, contactClients } from "@/lib/n8n-actions";
import { isOpenEscalation } from "./home-calc";

type Row = Record<string, unknown>;
const T = {
  clients: "rJpqXxmxhqJnlLrJ",
  queue: "LixqhIFzsJKk3dll",
  approvals: "3IvKKI4AwrBlDeOo",
  escalations: "ANfkZZDIrDuC4RjK",
  promises: "JyGFOqTqI3QXHJbb",
  logs: "a32Z5oGcNi0xzefb",
  conversations: "2WtfkEaHiBSzgItW",
  retries: "OgCEYfz7eGjS3dPz",
  reports: "bqDZYdPyb3JaFAsM",
  runLogs: "BVGj7FvvvVsg1QxY",
  health: "vu4Ar3YK7tj0VaKy",
};
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v) || 0;
const peso = (v: number) =>
  "PHP " + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isActive = (c: Row) => s(c["status"]).toUpperCase() !== "INACTIVE";
const at = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;
const manilaDay = (d: Date) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const rows = (id: string) => fetchAllDataTableRows<Row>(id).catch(() => [] as Row[]);
// Message logs: the assistant's tools look back at most 90 days.
const recentLogs = () =>
  fetchAllDataTableRows<Row>(T.logs, { sinceDays: 90, dateColumn: "timestamp" }).catch(
    () => [] as Row[],
  );

interface Invoice {
  branch: string;
  number: string;
  due: string;
  balance: number;
  status: string;
  days_overdue: number;
}
function invoicesOf(c: Row): Invoice[] {
  const out: Invoice[] = [];
  const today = Date.now();
  try {
    for (const b of JSON.parse(s(c["branches_data"]) || "[]")) {
      let inv: Row[] = [];
      try {
        inv = JSON.parse(s(b.invoice_details) || "[]");
      } catch {
        inv = [];
      }
      for (const i of inv) {
        const due = s(i["due_date"]);
        const dueMs = new Date(due).getTime();
        out.push({
          branch: s(b.branch_name),
          number: s(i["invoice_number"]),
          due: due.slice(0, 10),
          balance: n(i["balance"]),
          status: s(i["status"]).toUpperCase(),
          days_overdue: dueMs && dueMs < today ? Math.floor((today - dueMs) / 86400000) : 0,
        });
      }
    }
  } catch {
    // unreadable invoice data
  }
  return out;
}

async function loadCore() {
  const [clients, approvals, queue] = await Promise.all([
    rows(T.clients),
    rows(T.approvals),
    rows(T.queue),
  ]);
  const active = clients.filter((c) => isActive(c) && s(c["client_id"]));
  const cycle = cycleStart().getTime();
  const approved = new Map<string, Row>();
  for (const a of approvals)
    if (
      (a["approved"] === true || s(a["approved"]) === "true") &&
      (new Date(s(a["approved_at"])).getTime() || 0) >= cycle
    )
      approved.set(s(a["company_key"]).toLowerCase(), a);
  const pk = (c: Row) =>
    s(c["parent_name"] || c["client_name"])
      .trim()
      .toLowerCase();
  const branches = new Map<string, Set<string>>();
  for (const c of active) {
    const set = branches.get(pk(c)) ?? new Set<string>();
    s(c["branch_customer_ids"])
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => set.add(x));
    branches.set(pk(c), set);
  }
  const qBy = new Map(queue.map((q) => [s(q["client_id"]), q]));
  return { active, approved, branches, pk, qBy, queue, cycle };
}

/** Find one client by id or (part of) name among active clients. */
function findClient(active: Row[], ref: string): Row | undefined {
  const r = ref.trim().toLowerCase();
  return (
    active.find((c) => s(c["client_id"]).toLowerCase() === r) ||
    active.find((c) => s(c["client_name"]).toLowerCase() === r) ||
    active.find((c) => s(c["client_name"]).toLowerCase().includes(r)) ||
    active.find((c) => s(c["branches_data"]).toLowerCase().includes(r))
  );
}

function scopeIds(
  args: { use_working_set?: boolean | undefined; client?: string | undefined },
  ctx: ActionContext,
  active: Row[],
): Set<string> | null {
  if (args.client) {
    const c = findClient(active, args.client);
    return new Set(c ? [s(c["client_id"])] : []);
  }
  if (args.use_working_set && ctx.workingSet.length) return new Set(ctx.workingSet);
  return null;
}

// ------------------------------------------------------------------ read tools
registerAction({
  id: "get_overview",
  description:
    "Headline numbers: active clients, total outstanding / overdue / current, approvals this cycle, reminder queue by status, open escalations, promises.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({}),
  execute: async () => {
    const { active, approved, queue } = await loadCore();
    const [esc, prom] = await Promise.all([rows(T.escalations), rows(T.promises)]);
    const sum = (k: string) => active.reduce((t, c) => t + n(c[k]), 0);
    const qd: Record<string, number> = {};
    for (const q of queue)
      qd[s(q["queue_status"]).toUpperCase() || "(none)"] =
        (qd[s(q["queue_status"]).toUpperCase() || "(none)"] || 0) + 1;
    const data = {
      active_clients: active.length,
      total_outstanding: peso(sum("collection_amount")),
      overdue: peso(sum("overdue_total")),
      current: peso(sum("current_total")),
      approved_this_cycle: approved.size,
      reminder_queue: qd,
      open_escalations: esc.filter(isOpenEscalation).length,
      promises_recorded: prom.length,
    };
    return { data, summary: `overview: ${active.length} clients` };
  },
});

registerAction({
  id: "find_clients",
  description:
    "Search clients with unpaid invoices and filter them (all filters optional, combine freely). The result becomes the WORKING SET for follow-up questions; set use_working_set=true to filter the previous result further.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    name: z.string().max(120).optional().describe("part of the client / branch / contact name"),
    min_overdue: z.number().min(0).optional().describe("minimum overdue amount in PHP"),
    min_total: z.number().min(0).optional().describe("minimum total outstanding in PHP"),
    overdue_only: z.boolean().optional(),
    approval: z
      .enum(["approved", "pending"])
      .optional()
      .describe("approved / pending for contact this cycle"),
    sales_team: z
      .boolean()
      .optional()
      .describe("true = owner in Sales Team, false = Other Accounts"),
    multibranch: z.boolean().optional().describe("true = 5+ branch accounts"),
    no_contact: z.boolean().optional().describe("true = no phone and no email"),
    has_active_promise: z.boolean().optional(),
    received_channel: z
      .enum(["EMAIL", "SMS", "VIBER", "WHATSAPP", "VOICE"])
      .optional()
      .describe("received a reminder / call on this channel"),
    within_days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("for received_channel: within the last N days (default 7)"),
    use_working_set: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  execute: async (a, ctx) => {
    const { active, approved, branches, pk } = await loadCore();
    let list = active.filter((c) => n(c["collection_amount"]) > 0);
    if (a.use_working_set && ctx.workingSet.length)
      list = list.filter((c) => ctx.workingSet.includes(s(c["client_id"])));
    if (a.name) {
      const q = a.name.toLowerCase();
      list = list.filter((c) =>
        `${s(c["client_name"])} ${s(c["parent_name"])} ${s(c["contact_person"])} ${s(c["branches_data"])}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (a.min_overdue != null) list = list.filter((c) => n(c["overdue_total"]) >= a.min_overdue!);
    if (a.min_total != null) list = list.filter((c) => n(c["collection_amount"]) >= a.min_total!);
    if (a.overdue_only) list = list.filter((c) => n(c["overdue_total"]) > 0);
    if (a.approval)
      list = list.filter(
        (c) => approved.has(companyKey(c["client_id"])) === (a.approval === "approved"),
      );
    if (a.sales_team != null)
      list = list.filter(
        (c) =>
          (c["sales_team"] === false || s(c["sales_team"]) === "false" ? false : true) ===
          a.sales_team,
      );
    if (a.multibranch != null)
      list = list.filter((c) => (branches.get(pk(c))?.size ?? 0) >= 5 === a.multibranch);
    if (a.no_contact != null)
      list = list.filter((c) => (!s(c["phone"]) && !s(c["email"])) === a.no_contact);
    if (a.has_active_promise != null) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      list = list.filter(
        (c) =>
          (!!s(c["promise_suppressed_until"]) &&
            new Date(s(c["promise_suppressed_until"])) >= today) === a.has_active_promise,
      );
    }
    if (a.received_channel) {
      const since = Date.now() - (a.within_days ?? 7) * 86400000;
      const logs = await recentLogs();
      const ev = a.received_channel === "VOICE" ? "CALL_INITIATED" : "SEND_SUCCESS";
      const got = new Set(
        logs
          .filter(
            (l) =>
              s(l["channel"]).toUpperCase() === a.received_channel &&
              s(l["event_type"]).toUpperCase() === ev &&
              at(l) >= since,
          )
          .map((l) => companyKey(l["client_id"])),
      );
      list = list.filter((c) => got.has(companyKey(c["client_id"])));
    }
    list.sort(
      (x, y) =>
        n(y["overdue_total"]) - n(x["overdue_total"]) ||
        n(y["collection_amount"]) - n(x["collection_amount"]),
    );
    const limit = a.limit ?? 50;
    const out = list.slice(0, limit).map((c) => ({
      client_id: s(c["client_id"]),
      client: s(c["client_name"]),
      contact: s(c["contact_person"]),
      phone: s(c["phone"]),
      email: s(c["email"]),
      overdue: n(c["overdue_total"]),
      current: n(c["current_total"]),
      total: n(c["collection_amount"]),
      branches: branches.get(pk(c))?.size ?? 0,
      approved_this_cycle: approved.has(companyKey(c["client_id"])),
      sales_team:
        c["sales_team"] === false || s(c["sales_team"]) === "false"
          ? false
          : c["sales_team"] === true || s(c["sales_team"]) === "true"
            ? true
            : null,
    }));
    const totalAmt = list.reduce((t, c) => t + n(c["collection_amount"]), 0);
    const overdueAmt = list.reduce((t, c) => t + n(c["overdue_total"]), 0);
    return {
      data: {
        matched: list.length,
        shown: out.length,
        total_outstanding: peso(totalAmt),
        total_overdue: peso(overdueAmt),
        clients: out,
      },
      workingSet: { ids: list.map((c) => s(c["client_id"])), label: describeFilter(a) },
      summary: `find_clients: ${list.length} matched`,
    };
  },
});

function describeFilter(a: Record<string, unknown>): string {
  return (
    Object.entries(a)
      .filter(([, v]) => v !== undefined && v !== false && v !== "")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ") || "all clients"
  );
}

registerAction({
  id: "get_client",
  description:
    "Full details of ONE client: contact, amounts, every open invoice (branch, due date, days overdue), approval, Sales Team, promise / AR hold, last text and call this cycle, open escalations.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    client: z.string().min(2).max(200).describe("client id or (part of) the client / branch name"),
  }),
  execute: async (a) => {
    const { active, approved, branches, pk, qBy } = await loadCore();
    const c = findClient(active, a.client);
    if (!c)
      return {
        data: { found: false, message: `No active client matches "${a.client}".` },
        summary: "get_client: not found",
      };
    const [esc, tables] = await Promise.all([rows(T.escalations), loadActivityTables()]);
    const act = buildActivity(...tables)(s(c["client_id"]));
    const key = companyKey(c["client_id"]);
    const invoices = invoicesOf(c);
    const data = {
      client_id: s(c["client_id"]),
      client: s(c["client_name"]),
      parent: s(c["parent_name"]),
      contact: s(c["contact_person"]),
      phone: s(c["phone"]),
      email: s(c["email"]),
      sales_person: s(c["sales_person"]),
      account_owner: s(c["ar_owner"]),
      sales_team: c["sales_team"],
      branches: branches.get(pk(c))?.size ?? 0,
      overdue: n(c["overdue_total"]),
      current: n(c["current_total"]),
      total: n(c["collection_amount"]),
      approved_this_cycle: approved.has(key),
      approved_by: s(approved.get(key)?.["approved_by"]),
      queue_status: s(qBy.get(s(c["client_id"]))?.["queue_status"]),
      promise_until: s(c["promise_suppressed_until"]),
      ar_handoff_until: s(c["ar_handoff_until"]),
      last_contact: act,
      open_escalations: esc
        .filter(
          (e) =>
            companyKey(e["client_id"]) === key &&
            s(e["status"]).toUpperCase() !== "DONE" &&
            s(e["channel"]).toUpperCase() !== "SYSTEM",
        )
        .slice(0, 10)
        .map((e) => ({
          ref: s(e["ref"]),
          reason: s(e["reason"]).slice(0, 200),
          at: s(e["timestamp"]),
        })),
      invoices: invoices.slice(0, 60),
      invoice_count: invoices.length,
    };
    return {
      data,
      workingSet: { ids: [s(c["client_id"])], label: s(c["client_name"]) },
      summary: `get_client: ${s(c["client_name"])}`,
    };
  },
});

registerAction({
  id: "list_invoices",
  description:
    "Open invoices (one row per invoice) for one client, the working set, or all clients; filter overdue only / minimum days overdue.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    client: z.string().max(200).optional(),
    use_working_set: z.boolean().optional(),
    overdue_only: z.boolean().optional(),
    min_days_overdue: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(300).optional(),
  }),
  execute: async (a, ctx) => {
    const { active } = await loadCore();
    const scope = scopeIds(a, ctx, active);
    const list: (Invoice & { client: string })[] = [];
    for (const c of active) {
      if (scope && !scope.has(s(c["client_id"]))) continue;
      for (const i of invoicesOf(c)) {
        if (a.overdue_only && i.status !== "OVERDUE") continue;
        if (a.min_days_overdue != null && i.days_overdue < a.min_days_overdue) continue;
        list.push({ client: s(c["client_name"]), ...i });
      }
    }
    list.sort((x, y) => y.days_overdue - x.days_overdue);
    const total = list.reduce((t, i) => t + i.balance, 0);
    return {
      data: {
        invoices: list.length,
        total_balance: peso(total),
        rows: list.slice(0, a.limit ?? 100),
      },
      summary: `list_invoices: ${list.length}`,
    };
  },
});

registerAction({
  id: "message_history",
  description:
    "Reminder / call history from the message logs: per client or working set, channel, sent or failed, last N days. Includes failure reasons.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    client: z.string().max(200).optional(),
    use_working_set: z.boolean().optional(),
    channel: z.enum(["EMAIL", "SMS", "VIBER", "WHATSAPP", "VOICE"]).optional(),
    status: z.enum(["sent", "failed", "all"]).optional(),
    days: z.number().int().min(1).max(90).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  execute: async (a, ctx) => {
    const { active } = await loadCore();
    const scope = scopeIds(a, ctx, active);
    const keys = scope ? new Set([...scope].map((id) => companyKey(id))) : null;
    const since = Date.now() - (a.days ?? 14) * 86400000;
    const logs = (await recentLogs()).filter((l) => {
      if (at(l) < since) return false;
      if (keys && !keys.has(companyKey(l["client_id"]))) return false;
      if (a.channel && s(l["channel"]).toUpperCase() !== a.channel) return false;
      const ev = s(l["event_type"]).toUpperCase();
      const failed = ev.includes("FAIL") || s(l["status"]).toUpperCase() === "FAILED";
      if (a.status === "failed") return failed;
      if (a.status === "sent") return ev === "SEND_SUCCESS" || ev === "CALL_INITIATED";
      return ev !== "SEND_INITIATED";
    });
    logs.sort((x, y) => at(y) - at(x));
    const out = logs.slice(0, a.limit ?? 60).map((l) => ({
      at: s(l["timestamp"]),
      client: s(l["client_id"]).split("___")[0],
      channel: s(l["channel"]),
      event: s(l["event_type"]),
      status: s(l["status"]),
      error: s(l["error_message"]).slice(0, 200),
      source: s(l["trigger_source"]),
    }));
    return {
      data: { matched: logs.length, rows: out },
      summary: `message_history: ${logs.length}`,
    };
  },
});

registerAction({
  id: "failed_messages",
  description:
    "Failed sends and calls (email / SMS / Viber / WhatsApp / voice) in the last N days, grouped by failure reason, with the latest examples.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    channel: z.enum(["EMAIL", "SMS", "VIBER", "WHATSAPP", "VOICE"]).optional(),
    days: z.number().int().min(1).max(90).optional(),
  }),
  execute: async (a) => {
    const since = Date.now() - (a.days ?? 7) * 86400000;
    const logs = (await recentLogs()).filter((l) => {
      const ev = s(l["event_type"]).toUpperCase();
      return (
        at(l) >= since &&
        (ev.includes("FAIL") || s(l["status"]).toUpperCase() === "FAILED") &&
        (!a.channel || s(l["channel"]).toUpperCase() === a.channel)
      );
    });
    const byReason: Record<string, number> = {};
    for (const l of logs) {
      const r = (s(l["error_message"]) || "(no reason recorded)")
        .replace(/\s+/g, " ")
        .slice(0, 120);
      byReason[`${s(l["channel"])}: ${r}`] = (byReason[`${s(l["channel"])}: ${r}`] || 0) + 1;
    }
    logs.sort((x, y) => at(y) - at(x));
    return {
      data: {
        failed: logs.length,
        by_reason: Object.entries(byReason)
          .sort((x, y) => y[1] - x[1])
          .map(([reason, count]) => ({ reason, count })),
        latest: logs.slice(0, 25).map((l) => ({
          at: s(l["timestamp"]),
          client: s(l["client_id"]).split("___")[0],
          channel: s(l["channel"]),
          event: s(l["event_type"]),
          error: s(l["error_message"]).slice(0, 200),
        })),
      },
      summary: `failed_messages: ${logs.length}`,
    };
  },
});

registerAction({
  id: "promises",
  description:
    "Promise-to-pay records (latest per client) with state: DUE_TODAY, UPCOMING, BROKEN (date passed, balance still unpaid) or KEPT (balance paid). Optional state filter; the result becomes the working set.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({ state: z.enum(["DUE_TODAY", "UPCOMING", "BROKEN", "KEPT"]).optional() }),
  execute: async (a) => {
    const { active } = await loadCore();
    const prom = await rows(T.promises);
    const byCo = new Map(active.map((c) => [companyKey(c["client_id"]), c]));
    const latest = new Map<string, Row>();
    for (const p of prom) {
      const k = companyKey(p["client_id"]);
      if (!latest.has(k) || at(p) > at(latest.get(k)!)) latest.set(k, p);
    }
    const today = manilaDay(new Date());
    const list = [...latest.entries()].map(([k, p]) => {
      const d = s(p["promise_date"]).slice(0, 10);
      const c = byCo.get(k);
      const bal = c ? n(c["collection_amount"]) : 0;
      const state =
        d === today ? "DUE_TODAY" : d > today ? "UPCOMING" : bal > 0 ? "BROKEN" : "KEPT";
      return {
        client_id: c ? s(c["client_id"]) : s(p["client_id"]),
        client: s(p["client_name"]) || k,
        promise_date: d,
        balance_now: bal,
        state,
        channel: s(p["channel"]),
      };
    });
    const filtered = a.state ? list.filter((x) => x.state === a.state) : list;
    const counts: Record<string, number> = {};
    for (const x of list) counts[x.state] = (counts[x.state] || 0) + 1;
    return {
      data: { counts, rows: filtered.slice(0, 100) },
      workingSet: {
        ids: filtered.map((x) => x.client_id),
        label: `promises${a.state ? " " + a.state : ""}`,
      },
      summary: `promises: ${filtered.length}`,
    };
  },
});

registerAction({
  id: "escalations",
  description:
    "AR Worklist escalations (client replies / calls needing AR): status OPEN, IN_PROGRESS or DONE; with Ref, reason, channel.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  execute: async (a) => {
    const list = (await rows(T.escalations)).filter(
      (e) =>
        s(e["channel"]).toUpperCase() !== "SYSTEM" &&
        !/^not reached by phone/i.test(s(e["reason"])) &&
        (!a.status || (s(e["status"]).toUpperCase() || "OPEN") === a.status),
    );
    list.sort((x, y) => at(y) - at(x));
    return {
      data: {
        count: list.length,
        rows: list.slice(0, a.limit ?? 50).map((e) => ({
          ref: s(e["ref"]),
          client: s(e["client_name"]) || s(e["client_id"]).split("___")[0],
          status: s(e["status"]) || "OPEN",
          channel: s(e["channel"]),
          reason: s(e["reason"]).slice(0, 200),
          at: s(e["timestamp"]),
          handled_by: s(e["handled_by"]),
        })),
      },
      summary: `escalations: ${list.length}`,
    };
  },
});

registerAction({
  id: "queue_status",
  description:
    "This week's reminder queue: counts per status (WAITING_APPROVAL, PENDING, SENT, SKIPPED_..., STALE) and amounts.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({}),
  execute: async () => {
    const { queue, active } = await loadCore();
    const live = new Set(active.map((c) => s(c["client_id"])));
    const by: Record<string, { clients: number; amount: string }> = {};
    const acc: Record<string, { c: number; a: number }> = {};
    for (const q of queue) {
      const st = live.has(s(q["client_id"]))
        ? s(q["queue_status"]).toUpperCase() || "(none)"
        : "STALE";
      acc[st] = acc[st] || { c: 0, a: 0 };
      acc[st].c++;
      acc[st].a += n(q["collection_amount"]);
    }
    for (const [k, v] of Object.entries(acc)) by[k] = { clients: v.c, amount: peso(v.a) };
    return { data: by, summary: "queue_status" };
  },
});

registerAction({
  id: "reports",
  description:
    "AR reports already built (from /call, the dashboard and weekly runs): date, requested by, clients, totals, Google Sheet link.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  execute: async (a) => {
    const list = (await rows(T.reports)).sort((x, y) =>
      s(y["created_at"]).localeCompare(s(x["created_at"])),
    );
    return {
      data: list.slice(0, a.limit ?? 10).map((r) => ({
        as_of: s(r["as_of"]),
        requested_by: s(r["requested_by"]),
        source: s(r["source"]),
        clients: n(r["client_count"]),
        invoices: n(r["invoice_count"]),
        total: peso(n(r["total"])),
        overdue: peso(n(r["overdue"])),
        sheet_url: s(r["sheet_url"]),
      })),
      summary: "reports",
    };
  },
});

registerAction({
  id: "run_logs",
  description:
    "Weekly automation run logs (Daily run log): clients processed, queued per channel, skipped, sent, calls, replies, promises, escalations.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  execute: async (a) => {
    const list = (await rows(T.runLogs)).sort((x, y) =>
      s(y["run_date"]).localeCompare(s(x["run_date"])),
    );
    return {
      data: list.slice(0, a.limit ?? 5).map((r) => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r))
          if (!/details|_json|createdAt|updatedAt|^id$/.test(k)) o[k] = v;
        return o;
      }),
      summary: "run_logs",
    };
  },
});

// ------------------------------------------------------------------ UI actions (executed by the dashboard)
const PAGES: Record<string, string> = {
  overview: "/",
  clients: "/clients",
  reminder_queue: "/queue",
  contact_approvals: "/approvals",
  other_accounts: "/other-accounts",
  ar_worklist: "/worklist",
  promises: "/promises",
  contacts_to_fix: "/contacts",
  reports: "/reports",
  email: "/email",
  sms: "/sms",
  viber: "/viber",
  whatsapp: "/whatsapp",
  voice: "/voice",
  document_verification: "/verification",
};

registerAction({
  id: "workflow_health",
  description:
    "Health of the automation, checked every 30 minutes: SMS phone, Viber / Twilio / Vapi credit, stuck SMS or queues, failing workflows, failed sends and calls. Returns the open problems (urgent first) with what they affect and what to do, plus problems resolved in the last 24 hours. Use for 'check the workflows', 'is anything broken', 'why did X fail'.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({}),
  execute: async () => {
    const all = await rows(T.health);
    const day = Date.now() - 24 * 3600000;
    const open = all
      .filter((r) => s(r["status"]).toLowerCase() === "open")
      .sort(
        (a, b) =>
          (s(a["severity"]) === "urgent" ? 0 : 1) - (s(b["severity"]) === "urgent" ? 0 : 1) ||
          s(b["last_seen"]).localeCompare(s(a["last_seen"])),
      )
      .map((r) => ({
        severity: s(r["severity"]),
        title: s(r["title"]),
        detail: s(r["detail"]).slice(0, 400),
        affected: s(r["affected"]),
        what_to_do: s(r["suggested_fix"]),
        first_seen: s(r["first_seen"]),
        last_seen: s(r["last_seen"]),
        times_seen: n(r["occurrences"]),
      }));
    const resolved = all
      .filter(
        (r) =>
          s(r["status"]).toLowerCase() === "resolved" &&
          (new Date(s(r["resolved_at"])).getTime() || 0) >= day,
      )
      .map((r) => ({ title: s(r["title"]), resolved_at: s(r["resolved_at"]) }));
    return {
      data: {
        open_problems: open.length,
        open,
        resolved_last_24h: resolved,
        note: open.length ? undefined : "No open problems at the last check.",
      },
      summary: `workflow_health: ${open.length} open`,
    };
  },
});

registerAction({
  id: "navigate",
  description:
    "Open a dashboard page, optionally one client's page (client), and set the page filters (search text, status, date range).",
  kind: "ui",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    page: z.enum(Object.keys(PAGES) as [string, ...string[]]),
    client: z.string().max(200).optional().describe("open this client's page (id or name)"),
    search: z.string().max(120).optional(),
    status: z.string().max(40).optional(),
    range: z.enum(["all", "today", "7d", "30d"]).optional(),
  }),
  execute: async (a) => {
    if (a.client) {
      const { active } = await loadCore();
      const c = findClient(active, a.client);
      if (!c)
        return {
          data: { ok: false, message: `No client matches "${a.client}".` },
          summary: "navigate: client not found",
        };
      return {
        data: { ok: true, opened: s(c["client_name"]) },
        ui: { op: "navigate", to: `/clients/${encodeURIComponent(s(c["client_id"]))}` },
        summary: `navigate: client ${s(c["client_name"])}`,
      };
    }
    const search: Record<string, string> = {};
    if (a.search) search["q"] = a.search;
    if (a.status) search["status"] = a.status;
    if (a.range) search["range"] = a.range;
    return {
      data: { ok: true, opened: a.page },
      ui: { op: "navigate", to: PAGES[a.page] ?? "/", search },
      summary: `navigate: ${a.page}`,
    };
  },
});

registerAction({
  id: "refresh_data",
  description: "Reload the data shown on the current dashboard page.",
  kind: "ui",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({}),
  execute: async () => ({ data: { ok: true }, ui: { op: "refresh" }, summary: "refresh" }),
});

export const ASSISTANT_TOOLS_READY = true;

// ------------------------------------------------------------------ write actions (Phase 2: confirmation required)

async function resolveClients(
  a: { clients?: string[] | undefined; use_working_set?: boolean | undefined },
  ctx: ActionContext,
) {
  const { active } = await loadCore();
  const out: Row[] = [];
  const missing: string[] = [];
  if (a.use_working_set && ctx.workingSet.length) {
    for (const id of ctx.workingSet) {
      const c = active.find((x) => s(x["client_id"]) === id);
      if (c) out.push(c);
    }
  }
  for (const ref of a.clients ?? []) {
    const c = findClient(active, ref);
    if (c) out.push(c);
    else missing.push(ref);
  }
  const seen = new Set<string>();
  return {
    list: out.filter((c) => !seen.has(s(c["client_id"])) && !!seen.add(s(c["client_id"]))),
    missing,
  };
}

registerAction({
  id: "approve_clients",
  description:
    "Approve (or remove the approval of) clients on Contact Approvals for THIS cycle (Wednesday to Tuesday), by name or the working set. Approval only allows contact; it does not contact anyone. Clients whose account owner is not in the Sales Team cannot be approved.",
  kind: "write",
  permission: "ar",
  needsConfirmation: true,
  params: z.object({
    clients: z
      .array(z.string().min(2).max(200))
      .max(200)
      .optional()
      .describe("client names or ids"),
    use_working_set: z.boolean().optional(),
    approve: z.boolean().describe("true = approve, false = remove the approval"),
    allow_multibranch: z
      .boolean()
      .optional()
      .describe("true = also allow contacting 5+ branch accounts"),
    note: z.string().max(300).optional(),
  }),
  execute: async (a, ctx) => {
    const { list, missing } = await resolveClients(a, ctx);
    const eligible = list.filter(
      (c) => !(c["sales_team"] === false || s(c["sales_team"]) === "false"),
    );
    const blocked = list
      .filter((c) => c["sales_team"] === false || s(c["sales_team"]) === "false")
      .map((c) => s(c["client_name"]));
    if (!eligible.length)
      return {
        data: { saved: 0, missing, not_sales_team: blocked },
        summary: "approve_clients: nothing to save",
      };
    const r = await approveClients(
      ctx.userName,
      eligible.map((c) => ({
        client_id: s(c["client_id"]),
        client_name: s(c["client_name"]),
        approved: a.approve,
        note: a.note ?? "via AI assistant",
        allow_multibranch: !!a.allow_multibranch && a.approve,
      })),
    );
    return {
      data: {
        saved: r.saved,
        approve: a.approve,
        clients: eligible.map((c) => s(c["client_name"])),
        missing,
        not_sales_team: blocked,
      },
      ui: { op: "refresh" },
      summary: `approve_clients: ${a.approve ? "approved" : "removed"} ${r.saved}`,
    };
  },
});

registerAction({
  id: "contact_clients",
  description:
    "Contact clients NOW (replaces the former Zoho Cliq /call): Zoho refresh, fresh statement PDF, text (email, or Viber with SMS fallback) and a call from Grace. Max 20 per request. Only clients approved this cycle are contacted; promise, Sales Team, 5+ branches and the 4-day cooldown are checked. Returns the plan (who will be contacted, who is skipped and why). Use force only when the user explicitly asks to repeat a client already reached this week.",
  kind: "write",
  permission: "ar",
  needsConfirmation: true,
  params: z.object({
    clients: z.array(z.string().min(2).max(200)).max(20).optional().describe("client names or ids"),
    use_working_set: z.boolean().optional(),
    force: z.boolean().optional(),
  }),
  execute: async (a, ctx) => {
    const { list, missing } = await resolveClients(a, ctx);
    const names = [...list.map((c) => s(c["client_name"])), ...missing].slice(0, 20);
    if (!names.length)
      return {
        data: { started: false, message: "No clients given." },
        summary: "contact_clients: nothing",
      };
    const r = await contactClients(ctx.userName, names, !!a.force);
    return {
      data: { started: true, plan: r.reply, clients: names },
      summary: `contact_clients: ${names.length} requested`,
    };
  },
});
