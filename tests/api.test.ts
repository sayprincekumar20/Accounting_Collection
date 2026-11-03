import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked data tables (by table id) and a mocked fetch for the n8n webhooks. No real data, no network.
const tables: Record<string, Record<string, unknown>[]> = {};
vi.mock("../src/lib/n8n-datatable", () => ({
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
        approved_at: "2026-11-01T00:00:00Z",
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
    tables[APPROVALS] = [{ company_key: "alpha corp", approved: "true" }];
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
