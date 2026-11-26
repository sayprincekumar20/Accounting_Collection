import { describe, expect, it } from "vitest";
import { withSelectionRestored } from "../src/lib/invoice-selection";
import { withLiveStatus } from "../src/lib/live-status";

// The exact row n8n wrote in the live test (Nov 26): ONGOING TEST (300) unticked, 11.12 sent.
const inv = (n: string, bal: number) => ({
  invoice_number: n,
  balance: bal,
  amount: bal,
  status: "OVERDUE",
  due_date: "2026-10-09",
});
const row = {
  client_id: "ZOHO FORM TEST ACCOUNT___pk8543264@gmail.com",
  collection_amount: 11.12,
  overdue_total: 11.12,
  current_total: 0,
  invoice_numbers: "TEst, test sampleee",
  branches_data: JSON.stringify([
    {
      branch_name: "ZOHO FORM TEST ACCOUNT",
      collection_amount: 11.12,
      overdue_total: 11.12,
      current_total: 0,
      invoice_details: JSON.stringify([inv("TEst", 10), inv("test sampleee", 1.12)]),
    },
  ]),
  excluded_invoices_data: JSON.stringify([
    {
      branch: { branch_name: "ZOHO FORM TEST ACCOUNT", sales_person: "DEXTER JAY CANCINO" },
      invoice: inv("ONGOING TEST", 300),
    },
  ]),
};

describe("invoice selection shown on the dashboard", () => {
  it("the full balance is shown, the unticked invoice is marked, and selection tells what is sent", () => {
    const r = withSelectionRestored(row) as typeof row & { selection: Record<string, unknown> };
    expect(r.collection_amount).toBe(311.12);
    expect(r.overdue_total).toBe(311.12);
    expect(r.selection).toEqual({
      excluded: ["ONGOING TEST"],
      sent_amount: 11.12,
      sent_overdue: 11.12,
      selected_count: 2,
      total_count: 3,
    });
    const invs = JSON.parse(JSON.parse(r.branches_data)[0].invoice_details) as {
      invoice_number: string;
      excluded?: boolean;
    }[];
    expect(invs.map((i) => [i.invoice_number, !!i.excluded])).toEqual([
      ["TEst", false],
      ["test sampleee", false],
      ["ONGOING TEST", true],
    ]);
  });
  it("a branch whose invoices are all unticked comes back too", () => {
    const r = withSelectionRestored({
      ...row,
      excluded_invoices_data: JSON.stringify([
        { branch: { branch_name: "Annex" }, invoice: inv("9", 50) },
      ]),
    });
    expect(JSON.parse(r.branches_data).map((b: { branch_name: string }) => b.branch_name)).toEqual([
      "ZOHO FORM TEST ACCOUNT",
      "Annex",
    ]);
    expect(r.collection_amount).toBe(61.12);
  });
  it("rows without a selection are returned as they are; live status still applies after", () => {
    const plain = { ...row, excluded_invoices_data: "" };
    expect(withSelectionRestored(plain)).toBe(plain);
    expect(withLiveStatus(withSelectionRestored(row), "2026-11-26").collection_amount).toBe(311.12);
  });
});

import { sentView } from "../src/lib/invoice-selection";
describe("what is sent (reminder composer)", () => {
  it("only the ticked invoices: 11.12, not the full 311.12", () => {
    expect(sentView(withSelectionRestored(row))).toEqual({
      overdue: 11.12,
      current: 0,
      total: 11.12,
      statuses: ["OVERDUE", "OVERDUE"],
    });
  });
});
