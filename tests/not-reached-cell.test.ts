import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EscalatedCell, NotReachedCell } from "../src/components/collections/LogCells";

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

describe("Voice log status cells", () => {
  it("'Not reached' is its own amber status, not 'Escalated'", () => {
    const out = html(
      createElement(NotReachedCell, {
        row: {
          recorded_at: "2026-11-05T06:31:02Z",
          client_id: "102 IZAKAYA___639108278710",
          client_name: "102 IZAKAYA",
        },
      }),
    );
    expect(out).toContain("Not reached · details");
    expect(out).toContain("not an escalation");
    expect(out).toContain("text-warning");
    expect(out).not.toContain("Escalated");
  });
  it("a real escalation still shows as Escalated", () => {
    const out = html(
      createElement(EscalatedCell, {
        escalation: {
          reason: "Dispute: wrong amount",
          recorded_at: "2026-11-12T05:00:00Z",
          client_id: "A___1",
          client_name: "A",
        },
      }),
    );
    expect(out).toContain("Escalated · details");
  });
  it("nothing to show gives a dash", () => {
    expect(html(createElement(NotReachedCell, { row: undefined }))).toContain("—");
  });
});
