import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ListReview, SheetPicker } from "../src/components/assistant/ListReview";
import { fileStore, reviewStore } from "../src/components/assistant/list-store";
import { matchRows, type FileRow, type MatchClient } from "../src/lib/assistant/list-match";

const NOW = Date.UTC(2026, 10, 12, 2, 0, 0);
const client = (o: Partial<MatchClient>): MatchClient => ({
  client_id: "X___1",
  client_name: "X",
  parent_name: "",
  contact_person: "Ana",
  email: "a@x.com",
  phone: "639171234567",
  ar_owner: "Dave",
  sales_person: "",
  collection_schedule: "",
  overdue: 1000,
  current: 250,
  total: 1250,
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
  invoices: [
    {
      branch: "Alpha Makati",
      number: "INV-9",
      due: "2026-10-01",
      balance: 1000,
      status: "OVERDUE",
      counter: "",
    },
    {
      branch: "Alpha Makati",
      number: "INV-10",
      due: "2026-12-01",
      balance: 250,
      status: "SENT",
      counter: "2026-11-03",
    },
  ],
  ...o,
});
const file = (name: string, n: number, amount: number | null = null): FileRow => ({
  row: n,
  name,
  owner: "Dave",
  amount,
  remarks: "",
});

const clients = [
  client({ client_id: "A___1", client_name: "Alpha Foods" }),
  client({ client_id: "B___1", client_name: "Beta Meats", approved: true }),
  client({ client_id: "P___1", client_name: "Promised Co", promise_until: "2099-01-01T00:00:00Z" }),
  client({ client_id: "M___1", client_name: "Mega Chain", multibranch: true, branch_count: 7 }),
];
const rows = matchRows(
  [
    file("Alpha Foods", 4, 1000),
    file("Beta Meats", 5, 900),
    file("Promised Co", 6),
    file("Mega Chain", 7),
    file("Alpha Bakery", 8),
  ],
  clients,
  NOW,
);

const wrap = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));
const render = (id: string) =>
  wrap(createElement(ListReview, { reviewId: id, sessionId: "s", getUserName: () => "Prince" }));

beforeEach(() => {
  reviewStore.clear();
  fileStore.clear();
});

describe("ListReview", () => {
  it("shows the summary, every customer, its flags, and pre-selects only the clean ones", () => {
    reviewStore.set("r1", { id: "r1", fileName: "list.xlsx", sheet: "DAVE", rows, result: null });
    const html = render("r1");
    expect(html).toContain("list.xlsx · sheet DAVE");
    expect(html).toContain("1 approved");
    expect(html).toContain("2 need approval"); // Alpha + Mega Chain
    expect(html).toContain("1 blocked"); // Promised Co
    expect(html).toContain("Payment promise until 2099-01-01");
    expect(html).toContain("7 branches: AR contacts these on request");
    expect(html).toContain("Sheet says PHP 900.00, Zoho says PHP 1,000.00 overdue");
    // Pre-selected: Alpha (needs approval) and Beta (approved). NOT: Promised (blocked), Mega (warning), Alpha Bakery (no match).
    expect(html).toContain("2 selected · PHP 2,000.00 overdue · 1 to approve");
    expect(html).toContain("Approve + contact 2");
    expect(html).toContain("Select all ready (2)");
  });

  it("shows suggestions for a customer that was not found and does not let it be selected", () => {
    reviewStore.set("r1", { id: "r1", fileName: "l.xlsx", sheet: "S", rows, result: null });
    const html = render("r1");
    expect(html).toContain("Alpha Bakery");
    expect(html).toMatch(/Did you mean: [^<]*Alpha Foods/);
  });

  it("says 'Contact N' (not Approve) when everything selected is already approved", () => {
    const only = matchRows([file("Beta Meats", 5)], clients, NOW);
    reviewStore.set("r2", { id: "r2", fileName: "l.xlsx", sheet: "S", rows: only, result: null });
    const html = render("r2");
    expect(html).toContain("Contact 1");
    expect(html).not.toContain("Approve + contact");
  });

  it("after a successful run shows the outcome and no buttons to send again", () => {
    reviewStore.set("r1", {
      id: "r1",
      fileName: "l.xlsx",
      sheet: "S",
      rows,
      result: {
        ok: true,
        accepted: [{ client_id: "A___1", client_name: "Alpha Foods" }],
        approved: 1,
        rejected: [
          { client_id: "P___1", name: "Promised Co", reason: "Payment promise until 2099-01-01" },
        ],
        reply: "Running now: refreshing each client from Zoho first",
      },
    });
    const html = render("r1");
    expect(html).toContain("Started for 1 client");
    expect(html).toContain("1 approved first");
    expect(html).toContain("Running now: refreshing each client");
    expect(html).toContain("Not sent (1)");
    expect(html).not.toContain("Approve + contact");
    expect(html).not.toContain("Select all ready");
  });

  it("explains when the list is no longer loaded after a page reload", () => {
    expect(render("missing")).toContain("no longer loaded");
  });
});

describe("SheetPicker", () => {
  it("lists the sheets with their customer counts and disables sheets without customers", () => {
    fileStore.set("f1", {
      id: "f1",
      name: "x.xlsx",
      sheets: [
        { name: "ALL", rows: [file("A", 4), file("B", 5)], note: "" },
        { name: "NOTES", rows: [], note: "No Customer column" },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(SheetPicker, { fileId: "f1", onPick: () => {} }),
    );
    expect(html).toContain("ALL");
    expect(html).toContain("2 customers");
    expect(html).toContain("no Customer column");
    expect(html.match(/disabled=""/g)?.length).toBe(1);
  });
});
