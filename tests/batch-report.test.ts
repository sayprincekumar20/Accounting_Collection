import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import {
  AR_COLUMNS,
  BATCH_COLUMNS,
  batchClientRows,
  batchReportRows,
  clientOutcome,
  clientWindow,
  cycleEnd,
  parseBatch,
  summarizeOutcomes,
  type Batch,
} from "../src/lib/batch-report";
import { buildXlsx } from "../src/lib/xlsx-writer";

const T = (s: string) => new Date(s).getTime();
const NOW = T("2026-11-13T06:00:00Z"); // Fri Nov 13, 2:00 PM Manila

const batchRow = (at: string, by: string, clients: unknown[]) => ({
  batch_id: `${at}|${by}`,
  approved_at: at,
  approved_by: by,
  source: "dashboard",
  balance_at_approval: 30000,
  overdue_at_approval: 20000,
  clients_json: JSON.stringify(clients),
  note: "",
});
const A_ID = "ACME FOODS___acct@acme.ph";
const B_ID = "BETA CORP___639171234567";
const snapA = {
  client_id: A_ID,
  client_name: "Acme Foods",
  balance: 30000,
  overdue: 20000,
  invoices: [
    ["INV-1", 10000, "O"],
    ["INV-2", 10000, "O"],
    ["INV-3", 10000, "C"],
  ],
};
const b11 = parseBatch(
  batchRow("2026-11-12T03:00:00Z", "prince", [
    snapA,
    {
      client_id: B_ID,
      client_name: "Beta Corp",
      balance: 5000,
      overdue: 5000,
      invoices: [["B-1", 5000, "O"]],
    },
  ]),
)!; // Nov 12 11:00 AM
const b13 = parseBatch(
  batchRow("2026-11-12T05:00:00Z", "joanna", [
    { client_id: B_ID, client_name: "Beta Corp", balance: null, overdue: null, invoices: null },
  ]),
)!; // Nov 12 1:00 PM
const batches: Batch[] = [b11, b13];

const client = (id: string, invoices: unknown[], extra: Record<string, unknown> = {}) => ({
  client_id: id,
  client_name: id.split("___")[0],
  email: "acct@acme.ph",
  phone: "",
  status: "ACTIVE",
  sales_person: "Sam",
  ar_owner: "Dave",
  parent_name: id.split("___")[0],
  branches_data: JSON.stringify([
    { branch_name: id.split("___")[0], invoice_details: JSON.stringify(invoices) },
  ]),
  ...extra,
});

describe("batch windows", () => {
  it("a weekly cycle ends on the next Wednesday 00:00 Manila", () => {
    expect(new Date(cycleEnd(T("2026-11-12T04:27:05Z"))).toISOString()).toBe(
      "2026-11-17T16:00:00.000Z",
    );
    expect(new Date(cycleEnd(T("2026-11-11T08:38:31Z"))).toISOString()).toBe(
      "2026-11-17T16:00:00.000Z",
    );
  });
  it("a client approved again in a later batch: the earlier batch stops at that approval", () => {
    expect(clientWindow(b11, B_ID, batches, NOW).end).toBe(T("2026-11-12T05:00:00Z"));
    expect(clientWindow(b11, A_ID, batches, NOW).end).toBe(NOW); // not re-approved: until now
  });
});

describe("one client's outcome in a batch", () => {
  const logs = [
    {
      client_id: A_ID,
      channel: "EMAIL",
      event_type: "SEND_SUCCESS",
      timestamp: "2026-11-11T05:00:00Z",
    }, // BEFORE approval: not this batch
    {
      client_id: A_ID,
      channel: "VIBER",
      event_type: "SEND_FAILED",
      error_message: "not delivered",
      timestamp: "2026-11-12T05:03:00Z",
    },
    {
      client_id: A_ID,
      channel: "SMS",
      event_type: "SEND_SUCCESS",
      is_fallback: true,
      timestamp: "2026-11-12T05:04:00Z",
    },
    {
      client_id: A_ID,
      channel: "VOICE",
      event_type: "CALL_INITIATED",
      message_id: "c1",
      timestamp: "2026-11-12T06:30:00Z",
    },
    {
      client_id: A_ID,
      channel: "VOICE",
      event_type: "CALL_INITIATED",
      message_id: "c2",
      timestamp: "2026-11-12T08:30:00Z",
    },
  ];
  const calls = new Map([
    ["c1", { endedReason: "customer-did-not-answer", status: "ended" }],
    ["c2", { endedReason: "customer-ended-call", status: "ended" }],
  ]);
  const conversations = [
    {
      client_id: A_ID,
      channel: "VOICE",
      direction: "INBOUND",
      message_text: "Will pay on Monday po",
      timestamp: "2026-11-12T08:32:00Z",
    },
  ];
  const promises = [
    {
      client_id: A_ID,
      promise_date: "2026-11-16",
      channel: "VOICE",
      timestamp: "2026-11-12T08:33:00Z",
    },
  ];
  const escalations = [
    {
      client_id: A_ID,
      channel: "EMAIL",
      reason: "Dispute: invoice INV-2 amount",
      status: "IN_PROGRESS",
      ref: "R1",
      timestamp: "2026-11-12T09:00:00Z",
    },
    {
      client_id: A_ID,
      channel: "VOICE",
      reason: "Not reached by phone (busy), including the automatic retry.",
      timestamp: "2026-11-12T09:05:00Z",
    },
  ];
  // INV-1 paid since the approval: 20,000 open now (was 30,000)
  const now = client(A_ID, [
    {
      invoice_number: "INV-2",
      balance: 10000,
      amount: 10000,
      status: "OVERDUE",
      due_date: "2026-10-01",
      invoice_date: "2026-09-01",
    },
    {
      invoice_number: "INV-3",
      balance: 10000,
      amount: 10000,
      status: "CURRENT",
      due_date: "2026-12-01",
      invoice_date: "2026-11-01",
    },
  ]);
  const o = clientOutcome({
    batch: b11,
    bc: b11.clients[0]!,
    batches,
    client: now,
    logs,
    conversations,
    promises,
    escalations,
    calls,
    now: NOW,
  });

  it("only actions after the approval; channel, failure and fallback", () => {
    expect(o.channels_used).toEqual(["SMS"]); // the Nov 11 email belongs to no batch here
    expect(o.fallback).toBe("SMS (sent)");
    expect(o.text_status).toBe("Sent (SMS); 1 failed");
  });
  it("calls, pick-up, replies, confirmation, promise and escalation", () => {
    expect(o.calls.map((c) => c.result)).toEqual([
      "No answer",
      "Answered (customer ended the call)",
    ]);
    expect(o.picked_up).toBe("Yes");
    expect(o.replies[0]!.text).toBe("Will pay on Monday po");
    expect(o.ptp_date).toBe("2026-11-16");
    expect(o.confirmation).toBe("Promised to pay on 2026-11-16");
    expect(o.escalation).toBe("YES: Dispute: invoice INV-2 amount (Ref R1)");
    expect(o.escalation_status).toBe("IN PROGRESS");
    expect(o.not_reached_alert).toBe(true); // shown apart, never as the escalation
  });
  it("collection since approval: balance then vs now, and which invoices were paid", () => {
    expect(o.balance_at_approval).toBe(30000);
    expect(o.balance_now).toBe(20000);
    expect(o.collected).toBe(10000);
    expect(o.paid_invoices).toEqual(["INV-1"]);
    expect(o.outcome).toBe("Partly paid (PHP 10,000.00)");
  });

  it("the Beta Corp actions after 1:00 PM belong to the 1:00 PM batch, not the 11:00 AM one", () => {
    const bLogs = [
      {
        client_id: B_ID,
        channel: "SMS",
        event_type: "SEND_SUCCESS",
        timestamp: "2026-11-12T05:10:00Z",
      },
    ];
    const bNow = client(
      B_ID,
      [{ invoice_number: "B-1", balance: 5000, status: "OVERDUE", due_date: "2026-10-01" }],
      { email: "", phone: "639171234567" },
    );
    const in11 = clientOutcome({
      batch: b11,
      bc: b11.clients[1]!,
      batches,
      client: bNow,
      logs: bLogs,
      conversations: [],
      promises: [],
      escalations: [],
      calls: new Map(),
      now: NOW,
    });
    const in13 = clientOutcome({
      batch: b13,
      bc: b13.clients[0]!,
      batches,
      client: bNow,
      logs: bLogs,
      conversations: [],
      promises: [],
      escalations: [],
      calls: new Map(),
      now: NOW,
    });
    expect(in11.channels_used).toEqual([]);
    expect(in13.channels_used).toEqual(["SMS"]);
    expect(in13.collected).toBeNull(); // balance at approval not recorded for that client
  });

  it("summary of a batch", () => {
    expect(summarizeOutcomes([o])).toMatchObject({
      clients: 1,
      texted: 1,
      called: 1,
      picked_up: 1,
      replied: 1,
      promised: 1,
      escalated: 1,
      paid: 1,
      collected: 10000,
    });
  });

  it("report rows: the 22 AR columns unchanged, then the batch columns; a paid invoice is kept as PAID", () => {
    const rows = batchReportRows({
      batch: b11,
      outcomes: [o],
      clients: new Map([[A_ID, now]]),
      weeklyRemarks: [
        {
          client_id: A_ID,
          invoice_number: "INV-2",
          as_of: "2026-11-06",
          remarks: "NO ACTION THIS WEEK",
        },
      ],
      now: NOW,
    });
    expect(rows[0]![0]).toBe(
      "APPROVAL BATCH: NOV 12, 2026 11:00 AM (APPROVED BY PRINCE, 1 CLIENTS)",
    );
    expect(rows[2]).toEqual(["TOTAL", 20000]);
    expect(rows[5]).toEqual(["COLLECTED SINCE APPROVAL", 10000]);
    const header = rows[7]!;
    expect(header.slice(0, 22)).toEqual(AR_COLUMNS);
    expect(header.slice(22)).toEqual(BATCH_COLUMNS);
    const inv2 = rows.find((r) => r[5] === "INV-2")!;
    expect(inv2[11]).toBe("OVERDUE");
    expect(inv2[17]).toBe("NO ACTION THIS WEEK"); // remarks from last week
    expect(inv2[18]).toBe("SENT SMS REMINDER (11.12.26); CALLED (11.12.26); PROMISED 11.16.26");
    expect(inv2[19]).toBe("AR TO FOLLOW UP (ESCALATED)");
    expect(inv2[20]).toEqual({ date: "2026-11-16" });
    expect(inv2[22 + 3]).toBe("SMS (sent)"); // FALLBACK CHANNEL
    expect(inv2[22 + 7]).toBe("Yes"); // CALL PICKED UP
    const inv1 = rows.find((r) => r[5] === "INV-1")!;
    expect(inv1[11]).toBe("PAID SINCE APPROVAL");
    expect(rows.find((r) => r[5] === "INV-3")![18]).toBe("NOT YET DUE");
  });

  it("the Excel file opens and holds the values (both sheets)", async () => {
    const report = batchReportRows({
      batch: b11,
      outcomes: [o],
      clients: new Map([[A_ID, now]]),
      weeklyRemarks: [],
      now: NOW,
    });
    const bytes = buildXlsx([
      { name: "Report", rows: report, headerRow: 7, boldRows: 6 },
      { name: "Clients", rows: batchClientRows(b11, [o]), headerRow: 0 },
    ]);
    const sheets = (await readXlsxFile(Buffer.from(bytes))) as unknown as {
      sheet: string;
      data: unknown[][];
    }[];
    expect(sheets.map((x) => x.sheet)).toEqual(["Report", "Clients"]);
    const data = sheets[0]!.data;
    expect(data[7]![0]).toBe("SALES PERSON");
    const inv2 = data.find((r) => r[5] === "INV-2")!;
    expect(inv2[10]).toBe(10000);
    expect((inv2[8] as Date).toISOString().slice(0, 10)).toBe("2026-10-01"); // a real date
    expect(sheets[1]!.data[1]![0]).toBe("Acme Foods");
  });
});

import { replyOnly } from "../src/lib/batch-report";
describe("customer response text", () => {
  it("keeps only what the customer wrote (quoted thread removed)", () => {
    const raw =
      "i will pay on friday\n\nOn Thu, 12 Nov 2026 at 8:19 PM, prince kumar <pk8543264@gmail.com> wrote:\n\n> hello po\n>\n> On Thu, 12 Nov 2026 at 7:29 PM, <grace.accounting@rareglobalfood.com>\n> wrote:\n>\n>> retreyr";
    expect(replyOnly(raw)).toBe("i will pay on friday");
    expect(replyOnly("Will check po sa finance")).toBe("Will check po sa finance");
    expect(replyOnly("ok\n-----Original Message-----\nFrom: x")).toBe("ok");
  });
});
