import { describe, expect, it } from "vitest";
import { manilaToday, withLiveStatus } from "../src/lib/live-status";

const inv = (n: string, due: string, bal: number, status: string) => ({
  invoice_number: n,
  rule_due_date: due,
  due_date: due,
  balance: bal,
  amount: bal,
  status,
});
const gwMart = {
  client_id: "GW MART___willdrey_ang@yahoo.com",
  collection_amount: 4866778.98,
  overdue_total: 3935314.17,
  current_total: 931464.81,
  branches_data: JSON.stringify([
    {
      branch_name: "Gw Mart",
      collection_amount: 4866778.98,
      overdue_total: 3935314.17,
      current_total: 931464.81,
      invoice_details: JSON.stringify([
        inv("33198", "2026-11-25", 931464.81, "CURRENT"),
        inv("33177", "2026-11-24", 3935314.17, "OVERDUE"),
      ]),
    },
  ]),
};

describe("overdue status as of today", () => {
  it("Gw Mart #33198 (due Nov 25) is overdue on Nov 26: totals move, the amount owed does not", () => {
    const r = withLiveStatus(gwMart, "2026-11-26");
    expect(r.overdue_total).toBe(4866778.98);
    expect(r.current_total).toBe(0);
    expect(r.collection_amount).toBe(4866778.98);
    const b = JSON.parse(r.branches_data)[0];
    expect(b.overdue_total).toBe(4866778.98);
    expect(JSON.parse(b.invoice_details).map((i: { status: string }) => i.status)).toEqual([
      "OVERDUE",
      "OVERDUE",
    ]);
  });
  it("on its due date it is still current (overdue the day after)", () => {
    expect(withLiveStatus(gwMart, "2026-11-25")).toBe(gwMart);
  });
  it("the original row is not modified, and rows without current invoices are returned as they are", () => {
    withLiveStatus(gwMart, "2026-11-26");
    expect(gwMart.overdue_total).toBe(3935314.17);
    const allOverdue = {
      ...gwMart,
      branches_data: JSON.stringify([
        { invoice_details: JSON.stringify([inv("1", "2026-11-01", 5, "OVERDUE")]) },
      ]),
    };
    expect(withLiveStatus(allOverdue, "2026-11-26")).toBe(allOverdue);
  });
  it("Manila day", () => {
    expect(manilaToday(Date.parse("2026-11-25T16:30:00Z"))).toBe("2026-11-26");
    expect(manilaToday(Date.parse("2026-11-25T15:30:00Z"))).toBe("2026-11-25");
  });
});
