import { describe, expect, it, vi } from "vitest";

const tables: Record<string, Record<string, unknown>[]> = {};
vi.mock("../src/lib/n8n-datatable", () => ({
  fetchAllDataTableRows: async (id: string) => tables[id] ?? [],
  fetchDataTable: async (id: string) => ({ rows: tables[id] ?? [], truncated: false }),
  insertDataTableRows: async () => {},
  clearDataTableCache: () => {},
  truncationHeaders: () => ({}),
}));
const { escalationType, escalationAgeHours } = await import("../src/lib/escalation-type");
const { computeInsights, bucketOf } = await import("../src/routes/api/insights");

describe("escalationType (English and Taglish reasons)", () => {
  it.each([
    ["Claims already paid", "Paid claim"],
    ["Nagbayad na po ng kalahati - partial payment", "Paid claim"],
    ["Dispute: says the balance is wrong", "Dispute"],
    ["Missing PO numbers", "Document request"],
    ["SOA request via email", "Document request"],
    ["Customer asked for a call back tomorrow", "Callback"],
    ["Wrong number - not our client", "Wrong contact"],
    ["New contact email for accounting", "Contact change"],
    ["Something else entirely", "Other"],
  ])("%s -> %s", (reason, type) => expect(escalationType(reason)).toBe(type));
  it("measures open time until done", () => {
    expect(escalationAgeHours("2026-11-01T00:00:00Z", "DONE", "2026-11-01T06:00:00Z")).toBe(6);
    expect(
      escalationAgeHours(
        "2026-11-01T00:00:00Z",
        "OPEN",
        "",
        new Date("2026-11-03T00:00:00Z").getTime(),
      ),
    ).toBe(48);
  });
});

describe("computeInsights (mock data)", () => {
  const now = new Date("2026-11-11T02:00:00Z").getTime(); // Wed 11 Nov, 10:00 Manila
  const inv = (no: string, due: string, bal: number, status = "OVERDUE") => ({
    invoice_number: no,
    due_date: due,
    balance: bal,
    status,
  });
  const client = (id: string, invoices: object[], extra: Record<string, unknown> = {}) => ({
    client_id: id,
    client_name: id.split("___")[0],
    status: "ACTIVE",
    collection_amount: (invoices as { balance: number }[]).reduce((t, i) => t + i.balance, 0),
    overdue_total: (invoices as { balance: number; status: string }[])
      .filter((i) => i.status === "OVERDUE")
      .reduce((t, i) => t + i.balance, 0),
    branches_data: JSON.stringify([
      { branch_name: "B1", invoice_details: JSON.stringify(invoices) },
    ]),
    ...extra,
  });
  const clients = [
    client("A Co___a", [inv("1", "2026-11-01", 1000), inv("2", "2026-07-01", 5000)]), // 10 days, 133 days
    client("B Co___b", [inv("3", "2026-09-20", 2000), inv("4", "2026-11-30", 300, "CURRENT")]), // 52 days, current
  ];
  const promises = [
    { client_id: "A Co___a", promise_date: "2026-11-13", timestamp: "2026-11-11T01:00:00Z" },
  ];
  const r = computeInsights(
    clients,
    promises,
    [
      {
        entry_id: "e1",
        client_id: "A Co___a",
        channel: "SMS",
        reason: "Claims already paid",
        status: "",
        timestamp: "2026-11-08T00:00:00Z",
      },
      { entry_id: "e2", client_id: "B Co___b", channel: "SYSTEM", reason: "system alert" },
    ],
    [{ company_key: "a co", approved: true, approved_at: "2026-11-11T01:00:00Z" }],
    [
      {
        client_id: "A Co___a",
        channel: "VIBER",
        event_type: "SEND_SUCCESS",
        timestamp: "2026-11-11T01:10:00Z",
      },
      {
        client_id: "A Co___a",
        channel: "VOICE",
        event_type: "CALL_INITIATED",
        timestamp: "2026-11-11T01:20:00Z",
      },
    ],
    [
      {
        client_id: "A Co___a",
        channel: "VOICE",
        message_text: "AI: Hello po\nUser: next week",
        timestamp: "2026-11-11T01:25:00Z",
      },
    ],
    now,
  );

  it("puts invoices in the right aging bucket and counts the promised part", () => {
    const by = Object.fromEntries(r.aging.map((a) => [a.bucket, a]));
    expect(by["1-30 days"]).toMatchObject({ amount: 1000, promised: 1000 });
    expect(by["31-60 days"]).toMatchObject({ amount: 2000, promised: 0 });
    expect(by["90+ days"]).toMatchObject({ amount: 5000, promised: 5000 });
    expect(by["Current"]).toMatchObject({ amount: 300, promised: 0 });
  });
  it("promise pipeline: this week", () => {
    expect(r.pipeline.this_week).toEqual({ clients: 1, amount: 6000 });
  });
  it("escalations by type exclude system rows", () => {
    expect(r.escalations.find((e) => e.type === "Paid claim")).toMatchObject({ open: 1 });
    expect(r.escalations.reduce((t, e) => t + e.open + e.in_progress + e.done, 0)).toBe(1);
  });
  it("contact funnel this cycle", () => {
    expect(r.funnel.map((f) => f.clients)).toEqual([1, 1, 1, 1, 1]);
  });
  it("top overdue sorted by overdue amount", () => {
    expect(r.top_overdue.map((c) => c.client_name)).toEqual(["A Co", "B Co"]);
    expect(r.top_overdue[0]).toMatchObject({ oldest_days: 133, promised: true });
  });
  it("bucketOf: due today or later is current", () => {
    expect(bucketOf("2026-11-11", "OVERDUE", "2026-11-11")).toBe("Current");
    expect(bucketOf("2026-11-10", "OVERDUE", "2026-11-11")).toBe("1-30 days");
  });
});

describe("GET /api/client-snapshot", () => {
  it("returns the client's context with counter dates, and 400 without client_id", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      {
        client_id: "Snap Co___s@x.co",
        client_name: "Snap Co",
        status: "ACTIVE",
        contact_person: "Ana",
        phone: "639170000000",
        email: "s@x.co",
        ar_owner: "VANESSA LHEE CORTEJOS",
        credit_terms: "30 days",
        credit_limit: 50000,
        collection_schedule: "Friday",
        overdue_total: 100,
        current_total: 0,
        collection_amount: 100,
        branches_data: JSON.stringify([
          {
            branch_name: "B1",
            invoice_details: JSON.stringify([
              {
                invoice_number: "9",
                due_date: "2026-10-01",
                balance: 100,
                status: "OVERDUE",
                counter_date: "2026-09-01",
              },
            ]),
          },
        ]),
      },
    ];
    const mod = await import("../src/routes/api/client-snapshot");
    const h = (
      mod.Route as unknown as {
        options: { server: { handlers: { GET: (c: { request: Request }) => Promise<Response> } } };
      }
    ).options.server.handlers;
    expect((await h.GET({ request: new Request("https://x/api/client-snapshot") })).status).toBe(
      400,
    );
    const body = await (
      await h.GET({
        request: new Request("https://x/api/client-snapshot?client_id=Snap%20Co___s%40x.co"),
      })
    ).json();
    expect(body).toMatchObject({
      found: true,
      ar_owner: "VANESSA LHEE CORTEJOS",
      credit_terms: "30 days",
      collection_schedule: "Friday",
      total: 100,
    });
    expect(body.invoices[0]).toMatchObject({ number: "9", counter: "2026-09-01" });
  });
});
