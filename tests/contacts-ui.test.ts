// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

let search: Record<string, string> = {};
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useSearch: () => search }),
  Link: ({
    children,
    to,
    search: q,
    params,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
    params?: Record<string, string>;
  }) =>
    createElement(
      "a",
      {
        href: `${params?.clientId ? `/clients/${params.clientId}` : to}${q?.tab ? `?tab=${q.tab}` : ""}`,
        ...rest,
      },
      children,
    ),
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) =>
    createElement("div", null, actions, children),
}));
const { Route } = await import("../src/routes/contacts");
const Page = (Route as unknown as { component: () => ReactNode }).component;

const item = (n: number, o: Record<string, unknown> = {}) => ({
  client_id: `C${n}___x`,
  client_name: `Client ${String(n).padStart(2, "0")}`,
  parent_name: "",
  contact_person: "Ana",
  email: `c${n}@client.ph`,
  phone: "09171234567",
  ar_owner: "Dave",
  sales_person: "Sam",
  balance: 1000 * n,
  issues: [{ code: "NO_MOBILE", label: "No mobile number", detail: "Email only" }],
  reach: { email: true, phone: false },
  ...o,
});
const items = [
  ...Array.from({ length: 28 }, (_, k) => item(k + 1)),
  item(90, {
    client_name: "Maukas Foods",
    email: "maukas@fake.com",
    issues: [{ code: "FAKE_EMAIL", label: "Placeholder email", detail: "maukas@fake.com" }],
    reach: { email: false, phone: false },
  }),
  item(91, {
    client_name: "Shang Global City",
    issues: [{ code: "BOUNCED", label: "Email bounced", detail: "address not found (Nov 13)" }],
    reach: { email: false, phone: true },
  }),
];
const runs = [
  {
    run_date: "2026-11-18",
    run_timestamp: "2026-11-18T01:00:00Z",
    recorded: { no_contact: true, email_only: true },
    no_contact_details: [
      { parent_name: "IINE", branch_name: "IINE Makati", invoices: "123", amount: 3600 },
    ],
    email_only_details: [{ client_name: "Carl Trading", email: "c@t.ph", amount: 1775 }],
  },
];

beforeEach(() => {
  search = {};
  globalThis.fetch = (async (url: string) => {
    if (String(url) === "/api/contacts-to-fix")
      return new Response(JSON.stringify({ items }), { status: 200 });
    if (String(url) === "/api/daily-run-logs")
      return new Response(JSON.stringify({ runs }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => cleanup());
const mount = () =>
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Page)));

describe("Contacts to Fix (redesigned)", () => {
  it("tabs with counts and a one-line summary", async () => {
    mount();
    await screen.findByText("Client 28");
    const tabs = screen.getByRole("tablist");
    expect(within(tabs).getByRole("tab", { name: /All\s*30/ })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /Can't be reached\s*1/ })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /Email problems\s*2/ })).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /Last weekly run\s*2/ })).toBeTruthy();
    expect(screen.getByLabelText("Summary").textContent).toContain("30 clients to fix");
    expect(screen.getByLabelText("Summary").textContent).toContain("1 can't be reached at all");
  });
  it("pagination: 25 per page, next page shows the rest; search goes back to page 1", async () => {
    mount();
    await screen.findByText("Client 28");
    expect(screen.getByText("Showing 1–25 of 30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Showing 26–30 of 30")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "maukas" } });
    await waitFor(() => expect(screen.getByText("Showing 1–1 of 1")).toBeTruthy());
  });
  it("a tab shows only its problem; a row opens what is wrong, how to fix it and the client link", async () => {
    search = { tab: "email" };
    mount();
    await screen.findByText("Shang Global City");
    expect(screen.queryByText("Client 01")).toBeNull();
    fireEvent.click(screen.getByText("Shang Global City"));
    expect(screen.getByText("How to fix")).toBeTruthy();
    expect(screen.getByText(/correct email, then update it in Zoho CRM/)).toBeTruthy();
    expect(screen.getByText(/address not found/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open client/ }).getAttribute("href")).toBe(
      "/clients/C91___x",
    );
  });
  it("the last weekly run is a tab in the same list", async () => {
    search = { tab: "run" };
    mount();
    await screen.findByText("IINE Makati");
    expect(screen.getByText("Carl Trading")).toBeTruthy();
    expect(screen.getByText("No contact on file")).toBeTruthy();
    expect(screen.getByText("Email only, no mobile")).toBeTruthy();
  });
});
