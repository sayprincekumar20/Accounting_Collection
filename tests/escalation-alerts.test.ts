import { describe, expect, it } from "vitest";
import { isNotReachedReason } from "../src/lib/escalation-alerts";

describe("automatic 'Not reached by phone' alerts", () => {
  it("recognises the alert text (never an escalation)", () => {
    expect(
      isNotReachedReason(
        "Not reached by phone (customer-did-not-answer), including the automatic retry.",
      ),
    ).toBe(true);
    expect(isNotReachedReason("  not reached by phone (busy)")).toBe(true);
    expect(isNotReachedReason("Dispute: wrong amount")).toBe(false);
    expect(isNotReachedReason(undefined)).toBe(false);
  });
});

import { isSystemRow } from "../src/lib/escalation-alerts";
describe("system notifications vs customer escalations", () => {
  it("system: SYSTEM channels, SYSTEM client ids, workflow-failure wording", () => {
    expect(isSystemRow({ channel: "SYSTEM" })).toBe(true);
    expect(isSystemRow({ channel: "SYSTEM_ERROR", reason: "Workflow failed" })).toBe(true);
    expect(isSystemRow({ channel: "VOICE", client_id: "SYSTEM___cycle-close-out" })).toBe(true);
    expect(isSystemRow({ channel: "EMAIL", reason: "Workflow failed: 05_Email" })).toBe(true);
    expect(isSystemRow({ channel: "", reason: "Automation error: queue builder" })).toBe(true);
  });
  it("customer: disputes, payment issues, callbacks, follow-ups (even if they mention a failure)", () => {
    expect(isSystemRow({ channel: "EMAIL", reason: "Dispute: wrong amount" })).toBe(false);
    expect(isSystemRow({ channel: "VOICE_CALLBACK", reason: "Asked to be called back" })).toBe(
      false,
    );
    expect(
      isSystemRow({ channel: "SMS", reason: "Payment failed at the bank, will retry Friday" }),
    ).toBe(false);
  });
});
