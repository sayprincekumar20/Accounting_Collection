// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationsContent } from "../src/routes/notifications";
import { IssueTools } from "../src/components/collections/IssueTools";

const items = [
  {
    id: "SYSTEM___workflow-error-1",
    at: "2026-11-18T07:00:33+08:00",
    kind: "Error",
    title: "00_Zoho_Data_Fetch_Master_v3",
    summary: "Workflow failed: Drive quota",
    message: "Failed at: Search Date Folder",
    ref: "SYSTEM-20261118-070033",
    status: "OPEN",
    handled_by: "",
    ar_note: "",
  },
  {
    id: "SYSTEM___cycle-1",
    at: "2026-11-17T23:59:00+08:00",
    kind: "Cycle close-out",
    title: "Weekly cycle",
    summary: "Cycle closed",
    message: "",
    ref: "",
    status: "OPEN",
  },
];
let posted: Record<string, unknown> | null = null;
let asked: string[] = [];
const onAsk = (e: Event) => asked.push(String((e as CustomEvent<{ text: string }>).detail.text));
beforeEach(() => {
  posted = null;
  asked = [];
  window.addEventListener("rgf-assistant-ask", onAsk);
  sessionStorage.setItem("rgf-handler-name", "Prince");
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/notifications") return new Response(JSON.stringify({ items }), { status: 200 });
    if (u === "/api/worklist") {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.startsWith("/api/issue-history"))
      return new Response(
        JSON.stringify({
          items: [
            {
              event: "DIAGNOSIS",
              summary: "Google Drive API quota: too many requests per minute",
              actor: "AI assistant (asked by Prince)",
              at: "2026-11-21T04:00:00Z",
            },
          ],
        }),
        { status: 200 },
      );
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  window.removeEventListener("rgf-assistant-ask", onAsk);
  cleanup();
});
const mount = (el: React.ReactElement) =>
  render(createElement(QueryClientProvider, { client: new QueryClient() }, el));

describe("Escalations > System notifications tab", () => {
  it("a workflow failure has a status, Diagnose with AI and History; information notices have none", async () => {
    mount(createElement(NotificationsContent));
    await screen.findByText("00_Zoho_Data_Fetch_Master_v3");
    expect(screen.getAllByRole("button", { name: /Diagnose with AI/ })).toHaveLength(1); // only the failure
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Open failures")).toBeTruthy();
  });
  it("Done needs the resolution, which is saved with the status and the issue kind", async () => {
    mount(createElement(NotificationsContent));
    await screen.findByText("00_Zoho_Data_Fetch_Master_v3");
    window.prompt = () => "";
    fireEvent.click(screen.getByRole("button", { name: /Done…/ }));
    await waitFor(() => expect(screen.getByText(/give the resolution/)).toBeTruthy());
    expect(posted).toBeNull();
    window.prompt = () => "Drive credential reconnected";
    fireEvent.click(screen.getByRole("button", { name: /Done…/ }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      entry_id: "SYSTEM___workflow-error-1",
      status: "DONE",
      note: "Drive credential reconnected",
      issue_kind: "SYSTEM",
      ref: "SYSTEM-20261118-070033",
      handled_by: "Prince",
    });
  });
});

describe("Issue tools (both kinds)", () => {
  it("Diagnose with AI asks the assistant about this exact issue; History shows the recorded lines", async () => {
    mount(
      createElement(IssueTools, {
        issueId: "ACME-ESC-1",
        issueRef: "ESC-ACME-1",
        kind: "ESCALATION",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Diagnose with AI/ }));
    expect(asked[0]).toContain("Diagnose customer escalation ESC-ACME-1");
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    await waitFor(() =>
      expect(screen.getByLabelText("Issue history").textContent).toContain(
        "Google Drive API quota",
      ),
    );
    expect(screen.getByLabelText("Issue history").textContent).toContain("Diagnosis");
  });
});
