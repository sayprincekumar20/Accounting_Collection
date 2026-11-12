import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchClient } from "../src/lib/assistant/list-match";

// The server decides what is approved and sent: the network calls are mocked, the rules are the real ones.
const approve = vi.fn();
const contact = vi.fn();
const audit = vi.fn();
const items: Record<string, unknown>[] = [];

vi.mock("@/lib/approvals-data", () => ({
  loadApprovalItems: async () => ({ items, cycle_start: "2026-11-11T00:00:00Z" }),
}));
vi.mock("@/lib/n8n-datatable", () => ({ clearDataTableCache: vi.fn() }));
vi.mock("@/lib/n8n-actions", () => ({
  approveClients: (...a: unknown[]) => approve(...a),
  contactClients: (...a: unknown[]) => contact(...a),
}));
vi.mock("../src/lib/assistant/registry", () => ({ audit: (...a: unknown[]) => audit(...a) }));

import { runContactList, sanitizeRows } from "../src/lib/assistant/list-server";

const item = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  client_id: id,
  client_name: name,
  parent_name: "",
  contact_person: "",
  email: "x@y.com",
  phone: "639171234567",
  ar_owner: "",
  sales_person: "",
  collection_schedule: "",
  overdue: 1000,
  current: 0,
  total: 1000,
  branch_count: 1,
  multibranch: false,
  approved: false,
  allow_multibranch: false,
  text_this_cycle: false,
  call_this_cycle: false,
  promise_until: "",
  ar_handoff_until: "",
  sales_team: true,
  internal_account: false,
  invoices: [],
  ...o,
});
void ({} as MatchClient);

beforeEach(() => {
  approve.mockReset().mockResolvedValue({ ok: true, saved: 1 });
  contact.mockReset().mockResolvedValue({ reply: "Running now" });
  audit.mockReset().mockResolvedValue(undefined);
  items.length = 0;
});
const run = (ids: string[]) =>
  runContactList({ clientIds: ids, requestedBy: "Prince", sessionId: "s1", file: "list.xlsx" });

describe("runContactList", () => {
  it("approves only the clients that need it, then contacts everyone selected in ONE request", async () => {
    items.push(
      item("A___1", "Alpha Foods"),
      item("B___1", "Beta Meats", { approved: true }),
      item("C___1", "Gamma Hotel", { multibranch: true, branch_count: 6 }),
    );
    const r = await run(["A___1", "B___1", "C___1"]);
    expect(r.ok).toBe(true);
    const approved = approve.mock.calls[0]![1] as {
      client_id: string;
      allow_multibranch: boolean;
    }[];
    expect(approved.map((x) => x.client_id)).toEqual(["A___1", "C___1"]); // B was already approved
    expect(approved.find((x) => x.client_id === "C___1")!.allow_multibranch).toBe(true);
    expect(approved.find((x) => x.client_id === "A___1")!.allow_multibranch).toBe(false);
    expect(contact).toHaveBeenCalledTimes(1);
    expect(contact.mock.calls[0]![1]).toEqual(["Alpha Foods", "Beta Meats", "Gamma Hotel"]);
    expect(contact.mock.calls[0]![2]).toBe(false); // never forced
    expect(contact.mock.calls[0]![3]).toBe(100);
    expect(r.approved).toBe(2);
  });

  it("re-approves a 5+ branch client that was approved WITHOUT the multi-branch permission", async () => {
    items.push(
      item("M___1", "Mega Chain", {
        approved: true,
        multibranch: true,
        allow_multibranch: false,
        branch_count: 8,
      }),
    );
    await run(["M___1"]);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("does not call approve at all when everyone is already approved", async () => {
    items.push(item("B___1", "Beta Meats", { approved: true }));
    await run(["B___1"]);
    expect(approve).not.toHaveBeenCalled();
    expect(contact).toHaveBeenCalledTimes(1);
  });

  it("rejects (and never sends) blocked clients even if the browser selected them", async () => {
    items.push(
      item("OK___1", "Good Client"),
      item("PR___1", "Promised Client", { promise_until: "2099-01-01T00:00:00Z" }),
      item("NS___1", "Not Sales", { sales_team: false }),
      item("IN___1", "Internal Co", { internal_account: true }),
      item("DONE___1", "Done Already", { text_this_cycle: true, call_this_cycle: true }),
    );
    const r = await run(["OK___1", "PR___1", "NS___1", "IN___1", "DONE___1", "GONE___1"]);
    expect(r.ok).toBe(true);
    expect(contact.mock.calls[0]![1]).toEqual(["Good Client"]);
    expect(r.rejected.map((x) => x.name).sort()).toEqual(
      ["Done Already", "GONE", "Internal Co", "Not Sales", "Promised Client"].sort(),
    );
    expect(r.rejected.find((x) => x.name === "Promised Client")!.reason).toContain("promise");
  });

  it("does nothing when nothing can be contacted", async () => {
    items.push(item("PR___1", "Promised Client", { promise_until: "2099-01-01T00:00:00Z" }));
    const r = await run(["PR___1"]);
    expect(r.ok).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect(contact).not.toHaveBeenCalled();
  });

  it("two clients with the same exact name are never contacted by name", async () => {
    items.push(item("T1___1", "Twin Foods"), item("T2___1", "Twin Foods"));
    const r = await run(["T1___1", "T2___1"]);
    expect(r.ok).toBe(false);
    expect(contact).not.toHaveBeenCalled();
    expect(r.rejected[0]!.reason).toContain("share this exact name");
  });

  it("stops before contacting when saving the approvals fails", async () => {
    items.push(item("A___1", "Alpha Foods"));
    approve.mockRejectedValue(new Error("Saving approvals failed (500)"));
    await expect(run(["A___1"])).rejects.toThrow("Saving approvals failed");
    expect(contact).not.toHaveBeenCalled();
  });

  it("reports clearly when approvals were saved but the contact could not start", async () => {
    items.push(item("A___1", "Alpha Foods"));
    contact.mockRejectedValue(new Error("Starting the contact failed (502)"));
    const r = await run(["A___1"]);
    expect(r.ok).toBe(false);
    expect(r.approved).toBe(1);
    expect(r.error).toContain("approvals were saved");
  });

  it("writes an audit entry for what it did", async () => {
    items.push(item("A___1", "Alpha Foods"));
    await run(["A___1"]);
    const last = audit.mock.calls.at(-1)!;
    expect(last[1]).toBe("contact_list");
    expect(last[4]).toBe("OK");
  });
});

describe("sanitizeRows", () => {
  it("keeps only what matching needs and caps the size", () => {
    const rows = sanitizeRows([
      {
        row: 4,
        name: "  Alpha Foods  ",
        owner: "Dave",
        amount: 100,
        remarks: "x",
        evil: "<script>",
      },
      { row: 5, name: "" },
      { name: "Beta", amount: "12" },
      null,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      row: 4,
      name: "Alpha Foods",
      owner: "Dave",
      amount: 100,
      remarks: "x",
    });
    expect(rows[1]!.amount).toBeNull();
    expect(sanitizeRows("nope")).toEqual([]);
    expect(sanitizeRows(Array.from({ length: 500 }, (_, i) => ({ name: "N" + i }))).length).toBe(
      300,
    );
  });
});
