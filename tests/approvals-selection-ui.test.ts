// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useSearch: () => ({}) }),
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
  redirect: () => undefined,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) =>
    createElement("div", null, actions, children),
}));
const { Route } = await import("../src/routes/approvals");
const Page = (Route as unknown as { component: () => ReactNode }).component;

const inv = (number: string, balance: number, excluded = false) => ({
  branch: "ZOHO FORM TEST ACCOUNT",
  number,
  date: "2026-10-08",
  due: "2026-10-09",
  amount: balance,
  balance,
  status: "OVERDUE",
  po: "",
  counter: "",
  excluded,
});
const client = (over: Record<string, unknown> = {}) => ({
  client_id: "ZOHO FORM TEST ACCOUNT___pk8543264@gmail.com",
  client_name: "ZOHO FORM TEST ACCOUNT",
  parent_name: "",
  sales_person: "",
  ar_owner: "DEXTER",
  contact_person: "Rishi TEST",
  phone: "639173249458",
  email: "pk8543264@gmail.com",
  overdue: 311.12,
  current: 0,
  total: 311.12,
  due_date: "",
  promise_until: "",
  ar_handoff_until: "",
  refreshed_at: "2026-11-26T07:00:00Z",
  invoices: [inv("TEst", 10), inv("test sampleee", 1.12), inv("ONGOING TEST", 300)],
  approved: false,
  approved_by: "",
  approved_at: "",
  approval_note: "",
  branch_count: 1,
  multibranch: false,
  sales_team: true,
  approval_expired: false,
  text_this_cycle: false,
  call_this_cycle: false,
  last_text_at: "",
  last_text_channel: "",
  last_text_source: "",
  last_call_at: "",
  last_call_source: "",
  last_call_result: "",
  ...over,
});
let items: Record<string, unknown>[] = [];
let posted: { items: Record<string, unknown>[] } | null = null;
beforeEach(() => {
  items = [client()];
  posted = null;
  sessionStorage.setItem("rgf-handler-name", "Prince");
  window.prompt = () => "Prince";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url) === "/api/contact-approvals" && init?.method === "POST") {
      posted = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, saved: 1 }), { status: 200 });
    }
    if (String(url) === "/api/contact-approvals")
      return new Response(JSON.stringify({ items }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => cleanup());
const mount = () =>
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Page)));

describe("Contact Approvals: invoice selection", () => {
  it("all invoices ticked by default; unticking one shows what is sent; the last one cannot be unticked; Approve sends the selection", async () => {
    mount();
    await screen.findByText("ZOHO FORM TEST ACCOUNT");
    fireEvent.click(screen.getByText("Show 3 invoice(s)"));
    const box = (n: string) => screen.getByLabelText(`Send invoice ${n}`) as HTMLInputElement;
    expect([
      box("TEst").checked,
      box("test sampleee").checked,
      box("ONGOING TEST").checked,
    ]).toEqual([true, true, true]);

    fireEvent.click(box("ONGOING TEST"));
    expect(box("ONGOING TEST").checked).toBe(false);
    expect(screen.getByText(/2 of 3 invoices selected · PHP 11\.12 sent/)).toBeTruthy();
    expect(screen.getByText("not sent")).toBeTruthy();

    fireEvent.click(box("TEst"));
    fireEvent.click(box("test sampleee")); // the last one: refused
    expect(box("test sampleee").checked).toBe(true);
    expect(screen.getByText(/at least one invoice must stay selected/)).toBeTruthy();
    fireEvent.click(box("TEst")); // tick it back

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.items[0]).toMatchObject({
      client_id: "ZOHO FORM TEST ACCOUNT___pk8543264@gmail.com",
      approved: true,
      excluded_invoices: ["ONGOING TEST"],
    });
  });

  it("an approved client shows its saved selection; changing ticks offers 'Save selection'", async () => {
    items = [
      client({
        approved: true,
        approved_by: "Prince",
        approved_at: new Date().toISOString(),
        invoices: [inv("TEst", 10), inv("test sampleee", 1.12), inv("ONGOING TEST", 300, true)],
      }),
    ];
    mount();
    const status = (await screen.findByLabelText("Status")) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: "APPROVED" } });
    await screen.findByText("ZOHO FORM TEST ACCOUNT");
    await screen.findByText(/2 of 3 invoices selected · PHP 11\.12 sent/);
    expect(screen.queryByRole("button", { name: "Save selection" })).toBeNull();
    fireEvent.click(screen.getByText("Show 3 invoice(s)"));
    fireEvent.click(screen.getByLabelText("Send invoice ONGOING TEST"));
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.items[0]).toMatchObject({ approved: true, excluded_invoices: [] });
  });
});
