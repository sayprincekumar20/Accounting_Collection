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
