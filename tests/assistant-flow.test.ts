// @vitest-environment jsdom
// The real Assistant component in a simulated browser: attach a list, pick a sheet, review, approve + contact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/" } }),
}));

const inv = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    branch: "Branch " + (i % 2),
    number: "INV-" + i,
    date: "2026-09-01",
    due: i % 3 === 0 ? "2026-12-01" : "2026-10-0" + (1 + (i % 8)),
    amount: 1000,
    balance: 500 + i,
    status: i % 3 === 0 ? "SENT" : "OVERDUE",
    po: "",
    counter: i % 2 ? "2026-10-20" : "",
  }));
const item = (id: string, name: string, o: Record<string, unknown> = {}) => ({
  client_id: id,
  client_name: name,
  parent_name: "",
  contact_person: "Ana",
  email: "a@x.com",
  phone: "639171234567",
  ar_owner: "Dave",
  sales_person: "",
  collection_schedule: "",
  overdue: 1000,
  current: 50,
  total: 1050,
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
  invoices: inv(6),
  ...o,
});
const items = [
  item("S___1", "Sample Foods Inc."),
  item("D___1", "Demo Meats Corp", { approved: true }),
  item("T___1", "Test Hotel & Resort", { promise_until: "2099-01-01T00:00:00Z" }),
  item("A___1", "Alphalat Balesin Island Club Inc."),
];
vi.mock("@/lib/approvals-data", () => ({
  loadApprovalItems: async () => ({ items, cycle_start: "x" }),
}));
vi.mock("@/lib/n8n-datatable", () => ({ clearDataTableCache: vi.fn() }));
vi.mock("@/lib/n8n-actions", () => ({ approveClients: vi.fn(), contactClients: vi.fn() }));
vi.mock("@/lib/assistant/registry", () => ({ audit: vi.fn() }));

import { Assistant } from "../src/components/assistant/Assistant";
import { reviewStore } from "../src/components/assistant/list-store";
import { buildReview, sanitizeRows } from "../src/lib/assistant/list-server";

// Like Chrome 157+: scroll methods return a Promise (React must never receive it as an effect clean-up).
Element.prototype.scrollIntoView = (() =>
  Promise.resolve()) as unknown as typeof Element.prototype.scrollIntoView;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fixture = (n: string) => readFileSync(resolve(process.cwd(), "tests/fixtures", n));

let calls: { url: string; body: Record<string, unknown> }[] = [];
let tamper: ((rows: unknown[]) => unknown[]) | null = null;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function mount() {
  const view = render(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Assistant)),
  );
  fireEvent.click(screen.getByLabelText("Open the AI assistant"));
  return view;
}
async function attach(container: HTMLElement, name: string, data: Buffer) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([data], name, { type: XLSX })] } });
}

beforeEach(() => {
  localStorage.clear();
  reviewStore.clear();
  calls = [];
  tamper = null;
  window.prompt = () => "Tester";
  vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url: u, body });
    if (u.includes("/api/assistant/home"))
      return json({
        today: "x",
        stats: { overdue_accounts: 1, open_escalations: 0, promises_due: 0, workflow_issues: 0 },
        detail: { health: { urgent: 0, warning: 0 } },
        priorities: [],
        health_events: [],
        errors: [],
      });
    if (u.includes("/api/assistant/list-match")) {
      const r = await buildReview(sanitizeRows(body["rows"]));
      return json({ ...r, rows: tamper ? tamper(r.rows) : r.rows });
    }
    if (u.includes("/api/assistant/contact-list"))
      return json({
        ok: true,
        accepted: [{ client_id: "S___1", client_name: "Sample Foods Inc." }],
        approved: 1,
        rejected: [],
        reply: "Running now",
      });
    return json({}, 404);
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Assistant: contact list flow", () => {
  it("attach -> pick a sheet -> review -> Approve + contact -> started", async () => {
    const { container } = mount();
    await attach(container, "lists.xlsx", fixture("lists.xlsx"));
    await waitFor(() => expect(container.textContent).toContain("sheets with customers"));
    expect(screen.getByRole("button", { name: /^NOTES/ })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /^ALL/ }));
    await waitFor(() => expect(container.textContent).toContain('Sheet "ALL"'));
    expect(container.textContent).toContain("Sample Foods Inc.");
    expect(container.textContent).toContain("Payment promise until 2099-01-01"); // Test Hotel is blocked
    // Sample Foods needs approval, Demo Meats is approved: both pre-selected
    fireEvent.click(screen.getAllByText("Overview")[0]!);
    expect(container.textContent).toContain("Overdue ·");
    fireEvent.click(screen.getByRole("button", { name: /^Approve \+ contact 2/ }));
    await waitFor(() =>
      expect(container.textContent).toContain("1 will be approved for this cycle first"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(container.textContent).toContain("Started for 1 client"));
    const sent = calls.find((c) => c.url.includes("/api/assistant/contact-list"))!;
    expect((sent.body["client_ids"] as string[]).sort()).toEqual(["D___1", "S___1"]);
    expect(sent.body["requested_by"]).toBe("Tester");
  });

  it("a list of wrong names shows 'not found' and the page stays alive", async () => {
    const { container } = mount();
    await attach(container, "wrong.xlsx", fixture("wrong-names.xlsx"));
    await waitFor(() => expect(container.textContent).toContain('Sheet "ALL"'));
    expect(container.textContent).toContain("Not found (3)");
    expect(container.textContent).toMatch(/Did you mean:[^]*Alphalat Balesin Island Club Inc\./);
    expect(screen.getByRole("button", { name: /^Contact 0/ })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("odd values in the server's answer do not break the review screen", async () => {
    tamper = (rows) =>
      (rows as Record<string, unknown>[]).map((r) => ({
        ...r,
        flags: undefined,
        suggestions: null,
        client: r["client"]
          ? {
              ...(r["client"] as object),
              email: null,
              overdue: "1000",
              current: undefined,
              invoices: undefined,
            }
          : null,
      }));
    const { container } = mount();
    await attach(container, "lists.xlsx", fixture("lists.xlsx"));
    await waitFor(() => expect(container.textContent).toContain("sheets with customers"));
    fireEvent.click(screen.getByRole("button", { name: /^ALL/ }));
    await waitFor(() => expect(container.textContent).toContain("Sample Foods Inc."));
    for (const o of screen.getAllByText("Overview")) fireEvent.click(o);
    expect(container.textContent).toContain("No invoice details on file");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("typing a sheet name opens that sheet, like clicking it", async () => {
    const { container } = mount();
    await attach(container, "lists.xlsx", fixture("lists.xlsx"));
    await waitFor(() => expect(container.textContent).toContain("sheets with customers"));
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "dave" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(container.textContent).toContain('Sheet "DAVE"'));
    expect(calls.some((c) => c.url.includes("/api/assistant/chat"))).toBe(false);
  });

  it("the file's sheets and names go to the chat AI with the next question (hidden context)", async () => {
    const { container } = mount();
    await attach(container, "lists.xlsx", fixture("lists.xlsx"));
    await waitFor(() => expect(container.textContent).toContain("sheets with customers"));
    expect(container.textContent).not.toContain("LIST CONTEXT"); // not shown on screen
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "can you show me the names of those clients" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/assistant/chat"))).toBe(true),
    );
    const chat = calls.find((c) => c.url.includes("/api/assistant/chat"))!;
    const sent = JSON.stringify(chat.body["messages"]);
    expect(sent).toContain("[LIST CONTEXT, not shown to the user]");
    expect(sent).toContain('Sheet \\"DAVE\\" (2 customers)');
    expect(sent).toContain("Demo Meats Corp");
  });

  it("explains a file that is not Excel or CSV", async () => {
    const { container } = mount();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "list.pdf")] } });
    await waitFor(() => expect(container.textContent).toContain("Excel (.xlsx) or CSV"));
  });
});
