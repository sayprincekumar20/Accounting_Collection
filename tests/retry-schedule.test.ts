import { describe, expect, it } from "vitest";
import { endedReasonLabel, nextAttemptLabel, nextWeeklyRunLabel } from "../src/lib/retry-schedule";

// Thursday 2026-11-12 14:50 Manila = 06:50 UTC
const NOW = Date.UTC(2026, 10, 12, 6, 50);

describe("nextAttemptLabel (Manila time)", () => {
  it("tomorrow morning", () => {
    expect(nextAttemptLabel("2026-11-13T01:30:00.000Z", NOW)).toBe("tomorrow 9:30 AM");
  });
  it("later today", () => {
    expect(nextAttemptLabel("2026-11-12T08:15:00.000Z", NOW)).toBe("today 4:15 PM");
  });
  it("a later day shows the weekday and date", () => {
    expect(nextAttemptLabel("2026-11-16T01:30:00.000Z", NOW)).toBe("Mon, Nov 16 9:30 AM");
  });
  it("an overdue retry is placed at the next run", () => {
    expect(nextAttemptLabel("2026-11-12T05:00:00.000Z", NOW)).toContain("due now");
  });
  it("unknown date gives nothing", () => {
    expect(nextAttemptLabel("", NOW)).toBe("");
    expect(nextAttemptLabel("garbage", NOW)).toBe("");
  });
  it("midnight and noon read correctly", () => {
    expect(nextAttemptLabel("2026-11-13T04:00:00.000Z", NOW)).toBe("tomorrow 12:00 PM");
    expect(nextAttemptLabel("2026-11-13T16:05:00.000Z", NOW)).toBe("Sat, Nov 14 12:05 AM");
  });
});

describe("endedReasonLabel", () => {
  it("translates the common results", () => {
    expect(endedReasonLabel("customer-busy")).toBe("line busy");
    expect(endedReasonLabel("customer-did-not-answer")).toBe("no answer");
    expect(endedReasonLabel("voicemail")).toBe("went to voicemail");
    expect(endedReasonLabel("twilio-failed-to-connect-call")).toBe("could not connect");
    expect(endedReasonLabel("some-new-reason")).toBe("some new reason");
    expect(endedReasonLabel("")).toBe("");
  });
});

describe("nextWeeklyRunLabel", () => {
  it("from Thursday it is next Wednesday", () => {
    expect(nextWeeklyRunLabel(NOW)).toBe("Wed, Nov 18");
  });
  it("on Wednesday before 9:00 it is today; after 9:00 it is next week", () => {
    expect(nextWeeklyRunLabel(Date.UTC(2026, 10, 17, 22, 0))).toBe("Wed, Nov 18"); // Wed 06:00 Manila
    expect(nextWeeklyRunLabel(Date.UTC(2026, 10, 18, 3, 0))).toBe("Wed, Nov 25"); // Wed 11:00 Manila
  });
});
