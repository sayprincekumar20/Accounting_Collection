process.env.N8N_APPROVAL_SECRET = "test-approval";
process.env.N8N_CONTACT_SECRET = "test-contact";
process.env.N8N_WORKLIST_SECRET = "test-worklist";
process.env.N8N_WA_REMINDER_KEY = "test-wa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked data tables (by table id) and a mocked fetch for the n8n webhooks. No real data, no network.
const tables: Record<string, Record<string, unknown>[]> = {};
vi.mock("../src/lib/n8n-datatable", () => ({
  RECENT_60_DAYS: { sinceDays: 60, dateColumn: "timestamp" },
  fetchAllDataTableRows: async (id: string) => tables[id] ?? [],
  fetchDataTable: async (id: string) => ({ rows: tables[id] ?? [], truncated: false }),
  clearDataTableCache: () => {},
  truncationHeaders: () => ({}),
}));
type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = async (path: string) =>
  (
    (await import(`../src/routes/api/${path}.ts`)).Route as unknown as {
      options: { server: { handlers: Record<string, Handler> } };
    }
  ).options.server.handlers;
const call = async (path: string, method: "GET" | "POST", url = "/", body?: unknown) =>
  (await handlers(path))[method]!({
    request: new Request(
      "https://dash.example" + url,
      method === "POST"
        ? {
            method,
            body: typeof body === "string" ? body : JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }
        : undefined,
    ),
  });

const CLIENTS = "rJpqXxmxhqJnlLrJ",
  APPROVALS = "3IvKKI4AwrBlDeOo",
  ESCALATIONS = "ANfkZZDIrDuC4RjK",
  PROMISES = "JyGFOqTqI3QXHJbb";
const inv = (n: string, bal: number, status: string) => ({
  invoice_number: n,
  invoice_date: "2026-09-01",
  due_date: "2026-10-01",
  amount: bal,
  balance: bal,
  status,
});
const client = (id: string, extra: Record<string, unknown> = {}) => ({
  client_id: id,
  client_name: id.split("___")[0],
  status: "ACTIVE",
  collection_amount: 100,
  overdue_total: 60,
  current_total: 40,
  phone: "639170000000",
  email: "a@b.co",
  contact_person: "Ana",
  branches_data: JSON.stringify([
    {
      branch_name: "Branch 1",
      invoice_details: JSON.stringify([inv("INV-1", 60, "OVERDUE"), inv("INV-2", 40, "CURRENT")]),
    },
  ]),
  ...extra,
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ ok: true, saved: 1, updated: 1 }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/contact-approvals", () => {
  it("lists only active clients with a balance, pending first, with invoices", async () => {
    tables[CLIENTS] = [
      client("Alpha Corp___a@x.co"),
      client("Beta Inc___b@x.co", { collection_amount: 500, overdue_total: 500, current_total: 0 }),
      client("Gone Ltd___g@x.co", { status: "INACTIVE" }),
      client("Paid Co___p@x.co", { collection_amount: 0 }),
    ];
    tables[APPROVALS] = [
      {
        company_key: "alpha corp",
        approved: true,
        approved_by: "Maria",
        approved_at: new Date().toISOString(),
      },
    ];
    const r = await call("contact-approvals", "GET");
    expect(r.status).toBe(200);
    const items = (await r.json()).items as {
      client_name: string;
      approved: boolean;
      approved_by: string;
      invoices: unknown[];
    }[];
    expect(items.map((i) => i.client_name)).toEqual(["Beta Inc", "Alpha Corp"]); // pending first; inactive and zero-balance excluded
    expect(items[1]).toMatchObject({ approved: true, approved_by: "Maria" });
    expect(items[1]!.invoices).toHaveLength(2);
  });
  it("keeps the approval after a contact change (matched per company, case-insensitive)", async () => {
    tables[CLIENTS] = [client("ALPHA CORP___new.contact@x.co")];
    tables[APPROVALS] = [
      { company_key: "alpha corp", approved: "true", approved_at: new Date().toISOString() },
    ];
    const items = (await (await call("contact-approvals", "GET")).json()).items;
    expect(items[0].approved).toBe(true);
  });
  it("does not crash on unreadable invoice data", async () => {
    tables[CLIENTS] = [client("Bad Json___x@x.co", { branches_data: "{not json" })];
    const r = await call("contact-approvals", "GET");
    expect(r.status).toBe(200);
    expect((await r.json()).items[0].invoices).toEqual([]);
  });
});

describe("POST /api/contact-approvals", () => {
  it("rejects a request without a name or without clients (400) and does not call n8n", async () => {
    expect(
      (
        await call("contact-approvals", "POST", "/", {
          items: [{ client_id: "A___x", approved: true }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("contact-approvals", "POST", "/", { approved_by: "Maria", items: [] })).status,
    ).toBe(400);
    expect(
      (
        await call("contact-approvals", "POST", "/", {
          approved_by: "  ",
          items: [{ client_id: "A___x" }],
        })
      ).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON with an error response (not a crash)", async () => {
    const r = await call("contact-approvals", "POST", "/", "{oops");
    expect([400, 500]).toContain(r.status);
  });
  it("forwards approvals to n8n with the secret header", async () => {
    const r = await call("contact-approvals", "POST", "/", {
      approved_by: "Maria",
      items: [{ client_id: "A___x", client_name: "A", approved: true }],
    });
    expect(r.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhook/contact-approval-update");
    expect((init.headers as Record<string, string>)["x-approval-secret"]).toBeTruthy();
    expect(JSON.parse(String(init.body))).toMatchObject({
      approved_by: "Maria",
      items: [{ client_id: "A___x", approved: true }],
    });
  });
  it("caps a bulk request at 500 clients", async () => {
    const items = Array.from({ length: 700 }, (_, i) => ({
      client_id: `C${i}___x`,
      approved: true,
    }));
    await call("contact-approvals", "POST", "/", { approved_by: "Maria", items });
    expect(
      JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).items,
    ).toHaveLength(500);
  });
  it("reports a failure (500) when n8n rejects the save", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 403 }));
    expect(
      (
        await call("contact-approvals", "POST", "/", {
          approved_by: "Maria",
          items: [{ client_id: "A___x" }],
        })
      ).status,
    ).toBe(500);
  });
});

describe("POST /api/worklist", () => {
  it("validates entry_id and status", async () => {
    expect((await call("worklist", "POST", "/", { status: "DONE" })).status).toBe(400);
    expect(
      (await call("worklist", "POST", "/", { entry_id: "E1", status: "DELETED" })).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("saves a valid update through n8n (secret header, upper-cased status)", async () => {
    const r = await call("worklist", "POST", "/", {
      entry_id: "E1",
      status: "done",
      handled_by: "Maria",
      note: "paid",
    });
    expect(r.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-worklist-secret"]).toBeTruthy();
    expect(JSON.parse(String(init.body))).toMatchObject({
      entry_id: "E1",
      status: "DONE",
      handled_by: "Maria",
      note: "paid",
    });
  });
  it("returns 404 when the escalation no longer exists", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, updated: 0 }), { status: 200 }),
    );
    expect((await call("worklist", "POST", "/", { entry_id: "E404", status: "DONE" })).status).toBe(
      404,
    );
  });
  it("returns 500 when n8n is down", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await call("worklist", "POST", "/", { entry_id: "E1", status: "OPEN" })).status).toBe(
      500,
    );
  });
});

describe("GET /api/promises-board", () => {
  const day = (offset: number) =>
    new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  const states = async () =>
    Object.fromEntries(
      (
        (await (await call("promises-board", "GET")).json()).items as {
          client_name: string;
          state: string;
        }[]
      ).map((i) => [i.client_name, i.state]),
    );
  it("classifies due today, upcoming, broken and kept", async () => {
    tables[CLIENTS] = [
      client("Due___x"),
      client("Soon___x"),
      client("Late___x"),
      client("Paid___x", { collection_amount: 0 }),
    ];
    tables[PROMISES] = [
      {
        client_id: "Due___x",
        client_name: "Due",
        promise_date: day(0),
        timestamp: "2026-10-01T00:00:00Z",
      },
      {
        client_id: "Soon___x",
        client_name: "Soon",
        promise_date: day(3),
        timestamp: "2026-10-01T00:00:00Z",
      },
      {
        client_id: "Late___x",
        client_name: "Late",
        promise_date: day(-3),
        timestamp: "2026-10-01T00:00:00Z",
      },
      {
        client_id: "Paid___x",
        client_name: "Paid",
        promise_date: day(-3),
        timestamp: "2026-10-01T00:00:00Z",
      },
    ];
    expect(await states()).toMatchObject({
      Due: "DUE_TODAY",
      Soon: "UPCOMING",
      Late: "BROKEN",
      Paid: "KEPT",
    });
  });
  it("REGRESSION: a missed promise stays BROKEN after the client's contact changed (new client_id)", async () => {
    tables[CLIENTS] = [
      client("Moved Corp___old@x.co", { status: "INACTIVE" }),
      client("Moved Corp___new@x.co"),
    ];
    tables[PROMISES] = [
      {
        client_id: "Moved Corp___old@x.co",
        client_name: "Moved Corp",
        promise_date: day(-2),
        timestamp: "2026-10-01T00:00:00Z",
      },
    ];
    expect(await states()).toMatchObject({ "Moved Corp": "BROKEN" });
  });
});

describe("GET /api/client-timeline", () => {
  it("returns an empty list without a client_id", async () => {
    const r = await call("client-timeline", "GET", "/api/client-timeline");
    expect(r.status).toBe(200);
    expect((await r.json()).events).toEqual([]);
  });
});

describe("Contact Approvals: 5+ branch accounts", () => {
  it("flags parent companies with 5 or more branches (across contacts) and leaves smaller ones approvable", async () => {
    const CL = "rJpqXxmxhqJnlLrJ";
    tables[CL] = [
      client("BIG GROUP___a@x.co", { parent_name: "BIG GROUP", branch_customer_ids: "1,2,3" }),
      client("BIG GROUP___b@x.co", { parent_name: "BIG GROUP", branch_customer_ids: "4,5" }),
      client("SMALL CO___c@x.co", { parent_name: "SMALL CO", branch_customer_ids: "9,10" }),
    ];
    const items = (await (await call("contact-approvals", "GET")).json()).items as {
      client_id: string;
      multibranch: boolean;
      branch_count: number;
    }[];
    const by = Object.fromEntries(items.map((i) => [i.client_id, i]));
    expect(by["BIG GROUP___a@x.co"]).toMatchObject({ multibranch: true, branch_count: 5 });
    expect(by["BIG GROUP___b@x.co"]).toMatchObject({ multibranch: true, branch_count: 5 });
    expect(by["SMALL CO___c@x.co"]).toMatchObject({ multibranch: false, branch_count: 2 });
  });
});

describe("cycleStart (reminder cycle = Wednesday 00:00 Manila)", async () => {
  const { cycleStart } = await import("../src/lib/client-activity");
  const manila = (iso: string) => new Date(iso + "+08:00");
  it("returns the most recent Wednesday 00:00 Manila for every weekday", () => {
    const wed = manila("2026-11-04T00:00:00").toISOString();
    for (const d of [
      "2026-11-04T00:00:01",
      "2026-11-04T23:59:00",
      "2026-11-06T12:00:00",
      "2026-11-10T23:59:59",
    ]) {
      expect(cycleStart(manila(d)).toISOString()).toBe(wed);
    }
  });
  it("Tuesday still belongs to the previous cycle", () => {
    expect(cycleStart(manila("2026-11-03T10:00:00")).toISOString()).toBe(
      manila("2026-10-28T00:00:00").toISOString(),
    );
  });
});

describe("Contact Approvals: approval valid for one cycle, contact status this cycle", () => {
  const LOGS = "a32Z5oGcNi0xzefb";
  it("an approval from a previous cycle is expired (Pending again)", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [client("Old Co___o@x.co")];
    tables["3IvKKI4AwrBlDeOo"] = [
      {
        company_key: "old co",
        approved: true,
        approved_by: "Maria",
        approved_at: "2026-01-01T00:00:00Z",
      },
    ];
    const item = (await (await call("contact-approvals", "GET")).json()).items[0];
    expect(item).toMatchObject({ approved: false, approval_expired: true, approved_by: "Maria" });
  });
  it("shows the text and call of this cycle", async () => {
    const now = new Date().toISOString();
    tables["rJpqXxmxhqJnlLrJ"] = [client("Busy Co___b@x.co")];
    tables["3IvKKI4AwrBlDeOo"] = [{ company_key: "busy co", approved: true, approved_at: now }];
    tables[LOGS] = [
      {
        client_id: "Busy Co___b@x.co",
        channel: "VIBER",
        event_type: "SEND_SUCCESS",
        timestamp: now,
        trigger_source: "CLIQ_CALL",
        requested_by: "Juan",
      },
      {
        client_id: "Busy Co___b@x.co",
        channel: "VOICE",
        event_type: "CALL_INITIATED",
        timestamp: now,
        trigger_source: "CLIQ_CALL",
      },
    ];
    const item = (await (await call("contact-approvals", "GET")).json()).items[0];
    expect(item).toMatchObject({
      approved: true,
      text_this_cycle: true,
      call_this_cycle: true,
      last_text_channel: "VIBER",
      last_text_source: "/call · Juan",
    });
  });
  it("a client contacted only in an earlier cycle shows as not contacted this cycle", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [client("Quiet Co___q@x.co")];
    tables[LOGS] = [
      {
        client_id: "Quiet Co___q@x.co",
        channel: "EMAIL",
        event_type: "SEND_SUCCESS",
        timestamp: "2026-01-05T02:00:00Z",
      },
    ];
    const item = (await (await call("contact-approvals", "GET")).json()).items[0];
    expect(item).toMatchObject({ text_this_cycle: false, call_this_cycle: false });
  });
});

describe("Last contact: source of a text sent by /call", () => {
  it("labels an email / Viber send (no source in its log) with the /call that placed the call right after it", async () => {
    const { buildActivity } = await import("../src/lib/client-activity");
    const t0 = Date.now() - 60000;
    const logs = [
      {
        client_id: "A Co___a@x.co",
        channel: "EMAIL",
        event_type: "SEND_SUCCESS",
        timestamp: new Date(t0).toISOString(),
      },
      {
        client_id: "A Co___a@x.co",
        channel: "VIBER",
        event_type: "SEND_SUCCESS",
        timestamp: new Date(t0 + 20000).toISOString(),
      },
      {
        client_id: "A Co___a@x.co",
        channel: "VOICE",
        event_type: "CALL_INITIATED",
        timestamp: new Date(t0 + 21000).toISOString(),
        trigger_source: "CLIQ_CALL",
        requested_by: "PRINCE KUMAR",
      },
    ];
    const a = buildActivity(logs, [], [])("A Co___a@x.co");
    expect(a).toMatchObject({
      last_text_channel: "VIBER",
      last_text_source: "/call · PRINCE KUMAR",
      contacted_via_call_command: true,
    });
  });
  it("keeps 'Weekly run' when no /call call follows the text", async () => {
    const { buildActivity } = await import("../src/lib/client-activity");
    const logs = [
      {
        client_id: "B Co___b@x.co",
        channel: "EMAIL",
        event_type: "SEND_SUCCESS",
        timestamp: new Date().toISOString(),
      },
    ];
    expect(buildActivity(logs, [], [])("B Co___b@x.co").last_text_source).toBe("Weekly run");
  });
});

describe("GET /api/reminder-queue-list", () => {
  it("shows queue rows of retired (INACTIVE) or missing clients as STALE", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("Live Co___l@x.co"),
      client("Old Co___old@x.co", { status: "INACTIVE" }),
    ];
    tables["LixqhIFzsJKk3dll"] = [
      {
        client_id: "Live Co___l@x.co",
        client_name: "Live Co",
        queue_status: "WAITING_APPROVAL",
        collection_amount: 100,
      },
      {
        client_id: "Old Co___old@x.co",
        client_name: "Old Co",
        queue_status: "WAITING_APPROVAL",
        collection_amount: 100,
      },
      {
        client_id: "Gone Co___g@x.co",
        client_name: "Gone Co",
        queue_status: "SENT",
        collection_amount: 100,
      },
    ];
    const q = (await (await call("reminder-queue-list", "GET", "/api/reminder-queue-list")).json())
      .queue as { client_name: string; queue_status: string }[];
    const by = Object.fromEntries(q.map((r) => [r.client_name, r.queue_status]));
    expect(by).toEqual({ "Live Co": "WAITING_APPROVAL", "Old Co": "STALE", "Gone Co": "STALE" });
  });
});

describe("GET /api/channel-counters", () => {
  it("counts successful sends from today's message log", async () => {
    tables["2PaJlounpgxHtv6J"] = [
      { channel: "SMS", sent_count: 2, daily_limit: 50, date: "2026-11-12" },
    ];
    tables["a32Z5oGcNi0xzefb"] = [
      {
        channel: "SMS",
        event_type: "SEND_SUCCESS",
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      },
    ];

    const response = await call("channel-counters", "GET", "/api/channel-counters");
    const counters = (await response.json()).counters as {
      channel: string;
      sent_count: number;
      counter_sent_count: number;
    }[];

    expect(counters).toEqual([
      {
        channel: "sms",
        date: "2026-11-12",
        counter_sent_count: 2,
        sent_count: 1,
        daily_limit: 50,
        last_updated: "",
      },
    ]);
  });
});

describe("Sales Team rule on Contact Approvals", () => {
  it("returns sales_team true / false / null (not yet refreshed)", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("In Team___a@x.co", { sales_team: true }),
      client("Out Team___b@x.co", { sales_team: false }),
      client("Unknown___c@x.co"),
    ];
    const items = (await (await call("contact-approvals", "GET")).json()).items as {
      client_name: string;
      sales_team: boolean | null;
    }[];
    const by = Object.fromEntries(items.map((i) => [i.client_name, i.sales_team]));
    expect(by).toEqual({ "In Team": true, "Out Team": false, Unknown: null });
  });
});

describe("POST /api/contact-now (Approve & contact now for 5+ branch accounts)", () => {
  it("rejects a request without a requester or without names", async () => {
    expect((await call("contact-now", "POST", "/", { names: ["A"] })).status).toBe(400);
    expect(
      (await call("contact-now", "POST", "/", { requested_by: "Maria", names: [] })).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("runs the /call command as #Sales with the requester's name (max 20 names)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ reply: "Running now" }), { status: 200 }),
    );
    const names = Array.from({ length: 25 }, (_, i) => `Client ${i}`);
    const r = await call("contact-now", "POST", "/", { requested_by: "Maria", names });
    expect(r.status).toBe(200);
    expect((await r.json()).reply).toBe("Running now");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/webhook/cliq-call-command");
    expect((init.headers as Record<string, string>)["x-cliq-secret"]).toBeTruthy();
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ channel_unique_name: "sales", user_name: "Maria (dashboard)" });
    expect(String(body.text).split("\n")).toHaveLength(20);
  });
});

describe("authorship: SMS fallback after a failed Viber is an automated reminder", () => {
  it("matches the fallback SMS wording", async () => {
    const mod = await import("../src/lib/authorship");
    const ctx = { sendLog: [], conversations: [], escalations: [] } as unknown as Parameters<
      typeof mod.classifyOutbound
    >[0];
    const text =
      "Hi Eliza, you have an overdue balance with Rare Global Food Trading Corp totaling PHP 83,820.00. Please settle or reply with your payment date. Thank you!";
    expect(
      mod.classifyOutbound(ctx, {
        text,
        at: new Date().toISOString(),
        channel: "SMS",
        clientIds: [],
      } as never),
    ).toBe("reminder");
  });
});

describe("Contact Approvals: collection schedule from CRM", () => {
  it("returns the client's collection schedule", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("Sched Co___s@x.co", { collection_schedule: "Monday, Friday" }),
      client("Open Co___o@x.co"),
    ];
    const items = (await (await call("contact-approvals", "GET")).json()).items as {
      client_name: string;
      collection_schedule: string;
    }[];
    const by = Object.fromEntries(items.map((i) => [i.client_name, i.collection_schedule]));
    expect(by).toEqual({ "Sched Co": "Monday, Friday", "Open Co": "" });
  });
});

describe("GET /api/notifications (system messages formerly posted to Cliq)", () => {
  it("returns SYSTEM / callback rows with their full message, newest first, and not client escalations", async () => {
    tables["ANfkZZDIrDuC4RjK"] = [
      {
        entry_id: "a",
        client_id: "SYSTEM___manual-run",
        client_name: "Manual run",
        channel: "SYSTEM",
        reason: "Manual run by X",
        message: "MANUAL RUN FINISHED ...",
        timestamp: "2026-11-09T01:00:00Z",
      },
      {
        entry_id: "b",
        client_id: "SYSTEM___cycle-close-out",
        client_name: "Weekly cycle close-out",
        channel: "SYSTEM",
        reason: "Weekly cycle complete",
        message: "WEEKLY CYCLE ...",
        timestamp: "2026-11-09T02:00:00Z",
      },
      {
        entry_id: "c",
        client_id: "ABC CO___x",
        client_name: "ABC",
        channel: "VOICE_CALLBACK",
        reason: "Customer called back",
        timestamp: "2026-11-09T03:00:00Z",
      },
      {
        entry_id: "d",
        client_id: "ABC CO___x",
        client_name: "ABC",
        channel: "SMS",
        reason: "Claims paid",
        timestamp: "2026-11-09T04:00:00Z",
      },
    ];
    const items = (await (await call("notifications", "GET")).json()).items as {
      id: string;
      kind: string;
      message: string;
    }[];
    expect(items.map((i) => i.id)).toEqual(["c", "b", "a"]);
    expect(items.map((i) => i.kind)).toEqual(["Callback", "Cycle close-out", "/call result"]);
    expect(items[2]!.message).toContain("MANUAL RUN FINISHED");
  });
});

describe("Other Accounts: internal Rare accounts", () => {
  it("returns internal_account from the client row", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("MCSSI___docs@x.co", { sales_team: false, internal_account: true }),
      client("Other Co___o@x.co", { sales_team: false }),
    ];
    const items = (await (await call("contact-approvals", "GET")).json()).items as {
      client_name: string;
      internal_account: boolean;
    }[];
    const by = Object.fromEntries(items.map((i) => [i.client_name, i.internal_account]));
    expect(by).toMatchObject({ MCSSI: true, "Other Co": false });
  });
});

describe("GET /api/worklist (automatic 'Not reached' alerts)", () => {
  const rows = () => {
    tables["ANfkZZDIrDuC4RjK"] = [
      {
        entry_id: "E1",
        client_id: "102 IZAKAYA___639108278710",
        client_name: "102 IZAKAYA",
        channel: "VOICE",
        reason: "Not reached by phone (customer-did-not-answer), including the automatic retry.",
        ref: "102 IZAKAYA-20261105-143101",
        timestamp: "2026-11-05T14:31:02.329+08:00",
      },
      {
        entry_id: "E2",
        client_id: "102 IZAKAYA___639108278710",
        client_name: "102 IZAKAYA",
        channel: "EMAIL",
        reason: "Dispute: wrong amount",
        ref: "R2",
        timestamp: "2026-11-06T10:00:00+08:00",
      },
      {
        entry_id: "E3",
        client_id: "OTHER___x",
        client_name: "OTHER",
        channel: "VOICE",
        reason: "Not reached by phone (busy), including the automatic retry.",
        ref: "R3",
        timestamp: "2026-11-05T10:00:00+08:00",
      },
    ];
    tables["rJpqXxmxhqJnlLrJ"] = [];
  };

  it("the AR Worklist still leaves the automatic alerts out", async () => {
    rows();
    const items = (await (await call("worklist", "GET", "/api/worklist")).json()).items as {
      entry_id: string;
    }[];
    expect(items.map((i) => i.entry_id)).toEqual(["E2"]);
  });

  it("the client pop-up can ask for the alerts of ONE client, marked as automatic", async () => {
    rows();
    const url =
      "/api/worklist?include_alerts=1&client_id=" +
      encodeURIComponent("102 IZAKAYA___639108278710");
    const items = (await (await call("worklist", "GET", url)).json()).items as {
      entry_id: string;
      automatic: boolean;
    }[];
    expect(items.map((i) => [i.entry_id, i.automatic])).toEqual([
      ["E2", false],
      ["E1", true],
    ]);
  });
});
