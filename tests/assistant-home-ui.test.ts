import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantHome } from "../src/components/assistant/AssistantHome";
import type { HomeData } from "../src/components/assistant/home-data";

const data: HomeData = {
  today: "2026-11-12",
  stats: { overdue_accounts: 142, open_escalations: 12, promises_due: 8, workflow_issues: 2 },
  detail: { health: { urgent: 1, warning: 1 } },
  priorities: [
    {
      id: "escalations",
      title: "Review escalated customers",
      detail: "3 disputes need AR attention.",
      badge: "3 pending",
      tone: "danger",
      prompt: "Analyse the open escalations",
    },
    {
      id: "promises",
      title: "Payment promises",
      detail: "8 due today",
      badge: "8 due",
      tone: "warning",
      prompt: "Show the promises",
    },
  ],
  health_events: [
    {
      event_key: "sms_phone_offline",
      severity: "urgent",
      title: "SMS phone offline",
      detail: "Last contacted Telerivet 3 days ago.",
      affected: "",
      suggested_fix: "Charge the phone",
      last_seen: "2026-11-12T01:30:00Z",
    },
  ],
  errors: [],
};
const render = (props: Partial<Parameters<typeof AssistantHome>[0]>) =>
  renderToStaticMarkup(
    createElement(AssistantHome, {
      data,
      loading: false,
      failed: false,
      onAsk: () => {},
      onNavigate: () => {},
      ...props,
    }),
  );

describe("AssistantHome", () => {
  it("shows the greeting, the four numbers and the priority cards", () => {
    const html = render({});
    expect(html).toMatch(/Good (morning|afternoon|evening), AR Team!/);
    for (const [num, label] of [
      ["142", "Overdue accounts"],
      ["12", "Open escalations"],
      ["8", "Promises due"],
      ["2", "Workflow issues"],
    ] as const) {
      expect(html).toContain(num);
      expect(html).toContain(label);
    }
    expect(html).toContain("Review escalated customers");
    expect(html).toContain("3 pending");
    expect(html).toContain("Review cases"); // link to the Escalations page
    expect(html).toContain("What would you like me to do?");
  });

  it("shows dashes instead of numbers while loading or when a source failed", () => {
    const html = render({
      data: { ...data, stats: { ...data.stats, open_escalations: null }, errors: ["escalations"] },
    });
    expect(html).toContain("—");
    expect(html).toContain("Some numbers could not be loaded: escalations");
  });

  it("still renders (with a notice) when the numbers are unavailable", () => {
    const html = render({ data: undefined, failed: true });
    expect(html).toContain("Live numbers are unavailable right now");
    expect(html).toContain("Today&#x27;s priorities");
  });
});
