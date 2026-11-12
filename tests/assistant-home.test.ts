import { describe, expect, it } from "vitest";
import {
  buildPriorities,
  describeEscalationTypes,
  isClientEscalation,
  openEscalations,
  openHealth,
  overdueAccounts,
  promisesDue,
  waitingApproval,
  type HomeClient,
} from "../src/lib/assistant/home-calc";

const client = (o: Partial<HomeClient> = {}): HomeClient => ({
  client_id: "ACME___a@x.com",
  overdue: 1000,
  approved: false,
  internal_account: false,
  sales_team: true,
  multibranch: false,
  promise_until: "",
  ar_handoff_until: "",
  ...o,
});

describe("escalations", () => {
  it("ignores system notifications, callbacks and 'not reached' alerts", () => {
    expect(isClientEscalation({ channel: "SYSTEM_ERROR", reason: "Workflow failed" })).toBe(false);
    expect(isClientEscalation({ channel: "SYSTEM", reason: "x" })).toBe(false);
    expect(isClientEscalation({ channel: "VOICE_CALLBACK", reason: "x" })).toBe(false);
    expect(isClientEscalation({ channel: "VOICE", client_id: "SYSTEM___x", reason: "x" })).toBe(
      false,
    );
    expect(
      isClientEscalation({ channel: "VOICE", reason: "Not reached by phone today (busy)" }),
    ).toBe(false);
    expect(isClientEscalation({ channel: "EMAIL", reason: "Dispute: wrong amount" })).toBe(true);
  });

  it("counts only open ones and groups them by type", () => {
    const rows = [
      { channel: "EMAIL", reason: "Dispute: wrong amount", status: "" },
      { channel: "VOICE", reason: "Document request: SOA", status: "OPEN" },
      { channel: "EMAIL", reason: "Dispute: not ours", status: "IN_PROGRESS" },
      { channel: "EMAIL", reason: "Dispute: old one", status: "DONE" },
      { channel: "SYSTEM_ERROR", reason: "Workflow failed", status: "" },
    ];
    const r = openEscalations(rows);
    expect(r.count).toBe(3);
    expect(r.byType["Dispute"]).toBe(2);
    expect(r.byType["Document request"]).toBe(1);
    expect(describeEscalationTypes(r.byType)).toBe("2 disputes, 1 document request");
  });
});

describe("overdue accounts and approvals waiting", () => {
  const items = [
    client({ client_id: "A___1" }),
    client({ client_id: "B___1", overdue: 0 }),
    client({ client_id: "C___1", internal_account: true }),
    client({ client_id: "D___1", sales_team: false }),
    client({ client_id: "E___1", approved: true }),
    client({ client_id: "F___1", multibranch: true }),
    client({ client_id: "G___1", promise_until: "2099-01-01T00:00:00Z" }),
    client({ client_id: "H___1", ar_handoff_until: "2099-01-01T00:00:00Z" }),
    client({ client_id: "I___1", promise_until: "2000-01-01T00:00:00Z" }),
  ];
  it("counts the collection list, not internal or non-sales-team accounts, nor zero balances", () => {
    expect(overdueAccounts(items)).toBe(6); // A, E, F, G, H, I
  });
  it("counts only clients that approval would actually unlock", () => {
    // A, I (expired promise) are waiting; approved, multibranch, promise, hand-off, internal, non-sales are not.
    expect(waitingApproval(items, Date.UTC(2026, 10, 12))).toBe(2);
  });
});

describe("promises", () => {
  const owing = new Set(["acme", "beta"]);
  const rows = [
    { client_id: "ACME___a", promise_date: "2026-11-10", timestamp: "2026-11-05T01:00:00Z" },
    { client_id: "ACME___a", promise_date: "2026-11-12", timestamp: "2026-11-09T01:00:00Z" },
    { client_id: "BETA___b", promise_date: "2026-11-09", timestamp: "2026-11-03T01:00:00Z" },
    { client_id: "GAMMA___c", promise_date: "2026-11-08", timestamp: "2026-11-03T01:00:00Z" },
    { client_id: "DELTA___d", promise_date: "2026-11-20", timestamp: "2026-11-03T01:00:00Z" },
  ];
  it("uses the latest promise per company; missed only when still owing", () => {
    // ACME latest = Nov 12 (due today); BETA missed (owes); GAMMA passed but paid; DELTA upcoming.
    expect(promisesDue(rows, owing, "2026-11-12")).toEqual({ dueToday: 1, missed: 1 });
  });
});

describe("workflow health", () => {
  const rows = [
    {
      event_key: "a",
      severity: "warning",
      title: "W1",
      status: "open",
      last_seen: "2026-11-12T01:00:00Z",
    },
    {
      event_key: "b",
      severity: "urgent",
      title: "U1",
      status: "open",
      last_seen: "2026-11-12T00:00:00Z",
    },
    {
      event_key: "c",
      severity: "urgent",
      title: "old",
      status: "resolved",
      last_seen: "2026-11-11T00:00:00Z",
    },
    { event_key: "", severity: "urgent", title: "no key", status: "open" },
  ];
  it("counts open events, urgent first", () => {
    const h = openHealth(rows);
    expect(h.urgent).toBe(1);
    expect(h.warning).toBe(1);
    expect(h.total).toBe(2);
    expect(h.events.map((e) => e.title)).toEqual(["U1", "W1"]);
  });
});

describe("priorities", () => {
  const none = { urgent: 0, warning: 0, total: 0, events: [] };
  it("shows an all-clear card when nothing needs attention", () => {
    const p = buildPriorities({
      escalations: { count: 0, byType: {} },
      promises: { dueToday: 0, missed: 0 },
      waitingApproval: 0,
      health: none,
    });
    expect(p).toHaveLength(1);
    expect(p[0]!.tone).toBe("ok");
  });
  it("puts urgent workflow problems first, then escalations and promises", () => {
    const p = buildPriorities({
      escalations: { count: 3, byType: { Dispute: 3 } },
      promises: { dueToday: 2, missed: 1 },
      waitingApproval: 5,
      health: { urgent: 1, warning: 0, total: 1, events: [{ title: "SMS phone offline" }] },
    });
    expect(p.map((x) => x.id)).toEqual(["health", "escalations", "promises", "approvals"]);
    expect(p[1]!.badge).toBe("3 pending");
    expect(p[2]!.badge).toBe("3 due");
  });
});

describe("recent 'Not reached by phone' alerts count as open escalations", () => {
  const day = 86400000;
  const alert = (ageDays: number) => ({
    channel: "VOICE",
    status: "",
    reason: "Not reached by phone (customer-did-not-answer), including the automatic retry.",
    timestamp: new Date(Date.now() - ageDays * day).toISOString(),
  });
  it("only while they are under 7 days old", () => {
    expect(isClientEscalation(alert(1))).toBe(true);
    expect(isClientEscalation(alert(6))).toBe(true);
    expect(isClientEscalation(alert(8))).toBe(false);
  });
  it("are grouped as 'Not reached' and described for the priority card", () => {
    const r = openEscalations([
      alert(1),
      alert(2),
      alert(30),
      { channel: "EMAIL", reason: "Dispute: x" },
    ]);
    expect(r.count).toBe(3);
    expect(r.byType).toEqual({ "Not reached": 2, Dispute: 1 });
    expect(describeEscalationTypes(r.byType)).toBe("2 not-reached alerts, 1 dispute");
  });
});
