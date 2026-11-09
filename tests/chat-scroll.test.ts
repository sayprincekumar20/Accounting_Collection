import { describe, expect, it } from "vitest";
import { dayLabel, withDaySeparators } from "../src/components/collections/ChatScroll";

const at = (iso: string) => new Date(iso).getTime();
const days = (list: { at: number }[]) =>
  withDaySeparators(list).filter((x) => "kind" in x && x.kind === "day").length;

describe("day separators (WhatsApp style, Manila time)", () => {
  it("labels today and yesterday", () => {
    expect(dayLabel(Date.now())).toBe("Today");
    expect(dayLabel(Date.now() - 86400000)).toBe("Yesterday");
  });
  it("labels older days with weekday and date", () => {
    expect(dayLabel(at("2026-11-02T03:00:00Z"))).toMatch(/Mon.*Nov.*2.*2026/);
  });
  it("inserts one marker per day change, before the first message of each day", () => {
    const items = [
      { at: at("2026-11-02T01:00:00Z"), id: 1 },
      { at: at("2026-11-02T05:00:00Z"), id: 2 },
      { at: at("2026-11-03T01:00:00Z"), id: 3 },
    ];
    expect(withDaySeparators(items).map((x) => ("id" in x ? x.id : "day"))).toEqual([
      "day",
      1,
      2,
      "day",
      3,
    ]);
  });
  it("uses the Manila day, not the UTC day", () => {
    // Different UTC days, same Manila day (Nov 3, 1:00 AM and 10:00 AM Manila): one separator.
    expect(days([{ at: at("2026-11-02T17:00:00Z") }, { at: at("2026-11-03T02:00:00Z") }])).toBe(1);
    // Same UTC day, different Manila days (Nov 2, 11:00 PM and Nov 3, 7:30 AM Manila): two separators.
    expect(days([{ at: at("2026-11-02T15:00:00Z") }, { at: at("2026-11-02T23:30:00Z") }])).toBe(2);
  });
});
