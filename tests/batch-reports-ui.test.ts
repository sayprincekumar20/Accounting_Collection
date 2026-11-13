// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { unzipSync } from "fflate";
import { BatchReports } from "../src/components/reports/BatchReports";

const outcome = (name: string, extra: Record<string, unknown> = {}) => ({
  client_id: `${name}___x`,
  client_name: name,
  removed_at: "",
  window_start: "",
  window_end: "2026-11-13T06:00:00Z",
  texts: [],
  channels_used: ["VIBER"],
  fallback: "SMS (sent)",
  text_status: "Sent (VIBER)",
  calls: [{ at: "2026-11-12T06:30:00Z", result: "No answer", outcome: "not_answered" }],
  call_status: "No answer",
  picked_up: "No",
  not_reached_alert: true,
  replies: [],
  confirmation: "No response",
  ptp_date: "",
  escalation: "",
  escalation_status: "",
  balance_at_approval: null,
  balance_now: 48579.51,
  collected: null,
  paid_invoices: [],
  outcome: "Contacted, no response yet",
  ...extra,
});
const batches = [
  {
    batch_id: "b2",
    approved_at: "2026-11-12T05:00:00Z",
    approved_by: "joanna",
    source: "dashboard",
    note: "",
    label: "Nov 12, 2026 1:00 PM",
    balance_at_approval: 1,
    summary: {
      clients: 1,
      removed: 0,
      texted: 1,
      called: 1,
      picked_up: 0,
      replied: 0,
      promised: 0,
      escalated: 0,
      paid: 0,
      collected: 0,
    },
    outcomes: [outcome("102 IZAKAYA")],
  },
  {
    batch_id: "b1",
    approved_at: "2026-11-12T03:00:00Z",
    approved_by: "prince",
    source: "rebuilt",
    note: "Rebuilt from the approval records",
    label: "Nov 12, 2026 11:00 AM",
    balance_at_approval: null,
    summary: {
      clients: 2,
      removed: 0,
      texted: 2,
      called: 2,
      picked_up: 1,
      replied: 1,
      promised: 1,
      escalated: 1,
      paid: 0,
      collected: null,
    },
    outcomes: [
      outcome("FORA", { ptp_date: "2026-11-16", outcome: "Promise to pay (2026-11-16)" }),
      outcome("Whachop"),
    ],
  },
  {
    batch_id: "b0",
    approved_at: "2026-11-05T01:57:00Z",
    approved_by: "Prince",
    source: "rebuilt",
    note: "",
    label: "Nov 5, 2026 9:57 AM",
    balance_at_approval: null,
    summary: {
      clients: 1,
      removed: 0,
      texted: 0,
      called: 0,
      picked_up: 0,
      replied: 0,
      promised: 0,
      escalated: 0,
      paid: 0,
      collected: null,
    },
    outcomes: [outcome("Vikings")],
  },
];
let downloadedName = "";
let downloadedBytes: Uint8Array | null = null;
beforeEach(() => {
  downloadedName = "";
  downloadedBytes = null;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("/api/approval-batches"))
      return new Response(JSON.stringify({ batches }), { status: 200 });
    if (u.startsWith("/api/approval-batch-report"))
      return new Response(
        JSON.stringify({
          file_name: "Batch report - Nov 12, 2026 100 PM - joanna.xlsx",
          sheets: [
            {
              name: "Report",
              rows: [
                ["APPROVAL BATCH: NOV 12"],
                [],
                ["SALES PERSON", "CUSTOMER"],
                ["Sam", "102 IZAKAYA"],
              ],
              headerRow: 2,
              boldRows: 1,
              widths: [10, 30],
            },
          ],
        }),
        { status: 200 },
      );
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  URL.createObjectURL = ((b: Blob) => {
    void b.arrayBuffer().then((ab) => {
      downloadedBytes = new Uint8Array(ab);
    });
    return "blob:x";
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {
    downloadedName = this.download;
  };
});
afterEach(() => cleanup());

describe("Reports > Approval batch reports", () => {
  it("groups batches by day (newest first), one report per batch", async () => {
    const { container } = render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BatchReports),
      ),
    );
    await waitFor(() => expect(container.textContent).toContain("2 batches"));
    const text = container.textContent!;
    expect(text.indexOf("Nov 12, 2026")).toBeLessThan(text.indexOf("Nov 5, 2026"));
    expect(text).toContain("1:00 PM · 1 client");
    expect(text).toContain("11:00 AM · 2 clients");
    expect(text).toContain("Approved by joanna");
    expect(text).toContain("rebuilt from approval records");
    expect(text).toContain("Called 2 (picked up 1)");
  });
  it("shows the clients of ONE batch only", async () => {
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BatchReports),
      ),
    );
    const buttons = await screen.findAllByRole("button", { name: "Show clients" });
    fireEvent.click(buttons[1]!); // the 11:00 AM batch
    await waitFor(() => expect(screen.getByText("FORA")).toBeTruthy());
    expect(screen.getByText("Whachop")).toBeTruthy();
    expect(screen.queryByText("102 IZAKAYA")).toBeNull(); // other batch: not mixed in
    expect(screen.getByText("Promise to pay (2026-11-16)")).toBeTruthy();
    expect(screen.getAllByText(/fallback SMS \(sent\)/).length).toBeGreaterThan(0);
  });
  it("Excel downloads a real .xlsx named after the batch", async () => {
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(BatchReports),
      ),
    );
    const ex = await screen.findAllByRole("button", { name: /Excel/ });
    fireEvent.click(ex[0]!);
    await waitFor(() => expect(downloadedBytes?.length ?? 0).toBeGreaterThan(100));
    expect(downloadedName).toBe("Batch report - Nov 12, 2026 100 PM - joanna.xlsx");
    expect(Object.keys(unzipSync(downloadedBytes!))).toContain("xl/worksheets/sheet1.xml");
  });
});
