import { describe, expect, it } from "vitest";
import { parseSchedule, scheduleToday, manilaWeekday } from "../src/lib/schedule";

// Mock dates (Manila): 2026-11-09 Mon, 11-10 Tue, 11-11 Wed, 11-13 Fri
const at = (d: string, hhmm = "10:00") => new Date(`${d}T${hhmm}:00+08:00`);

describe("parseSchedule: values, capitalisation, spaces, NULL", () => {
  it.each([
    [["Friday"], "Friday"],
    [["Monday", "Tuesday"], "Monday, Tuesday"],
    ["Wednesday, Friday", "Wednesday, Friday"],
    ["  monday ,WEDNESDAY;friday ", "Monday, Wednesday, Friday"],
    ["Mon Wed Fri", "Monday, Wednesday, Friday"],
    ["fri.", "Friday"],
    ["Tues and Thurs", "Tuesday, Thursday"],
    [["Any Day"], "Any Day"],
    [["Any Days"], "Any Day"],
    ["anyday", "Any Day"],
    [["Friday", "Any Day"], "Any Day"],
  ])("%j -> %s", (v, label) => {
    expect(parseSchedule(v).label).toBe(label);
    expect(parseSchedule(v).configured).toBe(true);
  });
  it.each([null, undefined, "", [], "  ", "n/a", "xyz"])("%j -> not configured", (v) => {
    expect(parseSchedule(v)).toMatchObject({ configured: false, label: "" });
  });
});

describe("scheduleToday: eligibility and priority in Manila time", () => {
  it("listed day matching today: eligible, priority 1", () => {
    expect(scheduleToday(["Wednesday", "Friday"], at("2026-11-11"))).toMatchObject({
      eligible: true,
      priority: 1,
    });
    expect(scheduleToday(["Wednesday", "Friday"], at("2026-11-13"))).toMatchObject({
      eligible: true,
      priority: 1,
    });
  });
  it("listed days not today: not eligible (waits for the next day)", () => {
    expect(scheduleToday(["Wednesday", "Friday"], at("2026-11-09"))).toMatchObject({
      eligible: false,
      priority: 0,
    });
    expect(scheduleToday("Monday", at("2026-11-10"))).toMatchObject({ eligible: false });
  });
  it("Any Day: eligible every day, priority 2", () => {
    for (const d of ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-13"])
      expect(scheduleToday(["Any Day"], at(d))).toMatchObject({ eligible: true, priority: 2 });
  });
  it("empty / NULL: eligible with remaining slots, priority 3", () => {
    expect(scheduleToday(null, at("2026-11-09"))).toMatchObject({ eligible: true, priority: 3 });
    expect(scheduleToday("", at("2026-11-11"))).toMatchObject({ eligible: true, priority: 3 });
  });
  it("uses the Manila day, not UTC (Tue 23:30 UTC = Wed 07:30 Manila)", () => {
    const d = new Date("2026-11-10T23:30:00Z");
    expect(manilaWeekday(d)).toBe(3);
    expect(scheduleToday("Wednesday", d).eligible).toBe(true);
  });
  it("configured clients sort before empty ones", () => {
    const now = at("2026-11-11");
    const clients = [
      { n: "empty", s: null },
      { n: "any", s: ["Any Day"] },
      { n: "wed", s: ["Wednesday"] },
      { n: "fri", s: ["Friday"] },
    ];
    const order = clients
      .map((c) => ({ ...c, ...scheduleToday(c.s, now) }))
      .filter((c) => c.eligible)
      .sort((a, b) => a.priority - b.priority)
      .map((c) => c.n);
    expect(order).toEqual(["wed", "any", "empty"]);
  });
});
