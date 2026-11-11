process.env.N8N_APPROVAL_SECRET = "test-approval";
process.env.N8N_CONTACT_SECRET = "test-contact";
process.env.N8N_WORKLIST_SECRET = "test-worklist";
process.env.N8N_WA_REMINDER_KEY = "test-wa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const tables: Record<string, Record<string, unknown>[]> = {};
const inserted: { table: string; rows: Record<string, unknown>[] }[] = [];
vi.mock("../src/lib/n8n-datatable", () => ({
  RECENT_60_DAYS: { sinceDays: 60, dateColumn: "timestamp" },
  fetchAllDataTableRows: async (id: string) => tables[id] ?? [],
  fetchDataTable: async (id: string) => ({ rows: tables[id] ?? [], truncated: false }),
  insertDataTableRows: async (table: string, rows: Record<string, unknown>[]) =>
    void inserted.push({ table, rows }),
  clearDataTableCache: () => {},
  truncationHeaders: () => ({}),
}));
const { registerAction, runAction, getAction, toolDefinitions } =
  await import("../src/lib/assistant/registry");
await import("../src/lib/assistant/tools");

const ctx = (ws: string[] = []) => ({
  userName: "Tester",
  sessionId: "s1",
  page: "/",
  workingSet: ws,
});
const inv = (n: string, bal: number, status: string) => ({
  invoice_number: n,
  due_date: "2026-10-01",
  balance: bal,
  status,
});
const client = (
  id: string,
  overdue: number,
  current: number,
  extra: Record<string, unknown> = {},
) => ({
  client_id: id,
  client_name: id.split("___")[0],
  status: "ACTIVE",
  overdue_total: overdue,
  current_total: current,
  collection_amount: overdue + current,
  phone: "639170000000",
  email: "a@b.co",
  contact_person: "Ana",
  branch_customer_ids: id + "-b1",
  branches_data: JSON.stringify([
    {
      branch_name: "B1",
      invoice_details: JSON.stringify([
        inv("I1", overdue, "OVERDUE"),
        inv("I2", current, "CURRENT"),
      ]),
    },
  ]),
  ...extra,
});

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  inserted.length = 0;
});

describe("Action Registry", () => {
  registerAction({
    id: "test_write",
    description: "test write",
    kind: "write",
    permission: "ar",
    needsConfirmation: true,
    params: z.object({ amount: z.number().min(1) }),
    execute: async (a) => ({ data: { done: a.amount }, summary: "done" }),
  });
  it("rejects invalid arguments and unknown actions", async () => {
    expect((await runAction("test_write", { amount: "x" }, ctx())).ok).toBe(false);
    expect((await runAction("nope", {}, ctx())).error).toMatch(/Unknown action/);
  });
  it("never runs a write action without confirmation", async () => {
    const r = await runAction("test_write", { amount: 5 }, ctx());
    expect(r.ok).toBe(false);
    expect(r.needsConfirmation).toMatchObject({ id: "test_write", args: { amount: 5 } });
    const r2 = await runAction("test_write", { amount: 5 }, ctx(), true);
    expect(r2).toMatchObject({ ok: true, result: { data: { done: 5 } } });
  });
  it("audits every run (status, user, action)", async () => {
    await runAction("test_write", { amount: 2 }, ctx(), true);
    const rows = inserted.flatMap((i) => i.rows);
    expect(
      rows.some(
        (r) =>
          r["action_id"] === "test_write" && r["status"] === "OK" && r["user_name"] === "Tester",
      ),
    ).toBe(true);
  });
  it("exposes every registered action as a tool with a JSON schema", () => {
    const defs = toolDefinitions();
    const fc = defs.find((d) => d.function.name === "find_clients");
    expect(fc?.function.parameters).toMatchObject({ type: "object" });
    expect(defs.find((d) => d.function.name === "test_write")?.function.description).toMatch(
      /REQUIRES user confirmation/,
    );
    expect(getAction("navigate")?.kind).toBe("ui");
  });
});

describe("find_clients + working set (follow-up questions)", () => {
  it("filters and returns the working set; a follow-up narrows the same set", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("Big Co___a@x.co", 50000, 0),
      client("Mid Co___b@x.co", 20000, 5000),
      client("Paid Co___c@x.co", 0, 0),
    ];
    const r1 = await runAction("find_clients", { overdue_only: true }, ctx());
    expect(r1.result?.workingSet?.ids.sort()).toEqual(["Big Co___a@x.co", "Mid Co___b@x.co"]);
    const r2 = await runAction(
      "find_clients",
      { use_working_set: true, min_overdue: 30000 },
      ctx(r1.result!.workingSet!.ids),
    );
    expect(r2.result?.workingSet?.ids).toEqual(["Big Co___a@x.co"]);
  });
  it("received_channel uses the message logs", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("Big Co___a@x.co", 50000, 0),
      client("Mid Co___b@x.co", 20000, 0),
    ];
    tables["a32Z5oGcNi0xzefb"] = [
      {
        client_id: "Mid Co___b@x.co",
        channel: "SMS",
        event_type: "SEND_SUCCESS",
        timestamp: new Date().toISOString(),
      },
    ];
    const r = await runAction("find_clients", { received_channel: "SMS" }, ctx());
    expect(r.result?.workingSet?.ids).toEqual(["Mid Co___b@x.co"]);
  });
});

describe("promises", () => {
  it("BROKEN when the date passed and the balance is unpaid, KEPT when paid", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("Late Co___a@x.co", 1000, 0),
      client("Good Co___b@x.co", 0, 0),
    ];
    tables["JyGFOqTqI3QXHJbb"] = [
      {
        client_id: "Late Co___a@x.co",
        client_name: "Late Co",
        promise_date: "2026-01-02",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        client_id: "Good Co___b@x.co",
        client_name: "Good Co",
        promise_date: "2026-01-02",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ];
    const r = await runAction("promises", {}, ctx());
    expect((r.result?.data as { counts: Record<string, number> }).counts).toEqual({
      BROKEN: 1,
      KEPT: 1,
    });
  });
});

describe("navigate (UI action)", () => {
  it("opens a client page or a page with filters", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [client("Big Co___a@x.co", 50000, 0)];
    const r1 = await runAction("navigate", { page: "clients", client: "big co" }, ctx());
    expect(r1.result?.ui).toMatchObject({ op: "navigate", to: "/clients/Big%20Co___a%40x.co" });
    const r2 = await runAction("navigate", { page: "voice", range: "7d" }, ctx());
    expect(r2.result?.ui).toMatchObject({ op: "navigate", to: "/voice", search: { range: "7d" } });
    expect((await runAction("navigate", { page: "not-a-page" }, ctx())).ok).toBe(false);
  });
});

describe("Phase 2 write actions (confirmation required, real backend calls mocked)", () => {
  it("approve_clients: needs confirmation; then approves Sales Team clients only", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("Team Co___a@x.co", 1000, 0, { sales_team: true }),
      client("Other Co___b@x.co", 1000, 0, { sales_team: false }),
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, saved: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = await runAction(
      "approve_clients",
      { clients: ["Team Co", "Other Co"], approve: true },
      ctx(),
    );
    expect(pending.needsConfirmation).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    const r = await runAction(
      "approve_clients",
      { clients: ["Team Co", "Other Co"], approve: true },
      ctx(),
      true,
    );
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/webhook/contact-approval-update");
    const body = JSON.parse(String(init.body));
    expect(body.items.map((i: { client_id: string }) => i.client_id)).toEqual(["Team Co___a@x.co"]);
    expect((r.result?.data as { not_sales_team: string[] }).not_sales_team).toEqual(["Other Co"]);
    vi.unstubAllGlobals();
  });
  it("contact_clients: needs confirmation; then starts the contact process for the working set", async () => {
    tables["rJpqXxmxhqJnlLrJ"] = [
      client("Team Co___a@x.co", 1000, 0),
      client("Mid Co___b@x.co", 1000, 0),
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ reply: "Running now (2)" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (
        await runAction(
          "contact_clients",
          { use_working_set: true },
          ctx(["Team Co___a@x.co", "Mid Co___b@x.co"]),
        )
      ).needsConfirmation,
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    const r = await runAction(
      "contact_clients",
      { use_working_set: true },
      ctx(["Team Co___a@x.co", "Mid Co___b@x.co"]),
      true,
    );
    expect((r.result?.data as { plan: string }).plan).toBe("Running now (2)");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/webhook/cliq-call-command");
    expect(String(JSON.parse(String(init.body)).text).split("\n")).toEqual(["Team Co", "Mid Co"]);
    vi.unstubAllGlobals();
  });
});
