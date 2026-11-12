import { describe, expect, it } from "vitest";
import { isNotReachedReason, isRecentNotReachedAlert } from "../src/lib/escalation-alerts";

const NOW = Date.UTC(2026, 10, 12);
const reason = "Not reached by phone (customer-did-not-answer), including the automatic retry.";

describe("automatic 'Not reached by phone' alerts", () => {
  it("recognises the alert text", () => {
    expect(isNotReachedReason(reason)).toBe(true);
    expect(isNotReachedReason("Dispute: wrong amount")).toBe(false);
    expect(isNotReachedReason(undefined)).toBe(false);
  });
  it("is recent for 7 days, using timestamp or createdAt", () => {
    expect(isRecentNotReachedAlert({ reason, timestamp: "2026-11-11T09:00:00+08:00" }, NOW)).toBe(
      true,
    );
    expect(isRecentNotReachedAlert({ reason, createdAt: "2026-11-06T00:00:00Z" }, NOW)).toBe(true);
    expect(isRecentNotReachedAlert({ reason, timestamp: "2026-11-01T00:00:00Z" }, NOW)).toBe(false);
    expect(isRecentNotReachedAlert({ reason }, NOW)).toBe(false); // no date: never counted
    expect(
      isRecentNotReachedAlert({ reason: "Dispute", timestamp: "2026-11-11T00:00:00Z" }, NOW),
    ).toBe(false);
  });
});
