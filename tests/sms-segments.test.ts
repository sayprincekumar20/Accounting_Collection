import { describe, expect, it } from "vitest";
import { estimateSmsSegments } from "../src/lib/sms-segments";

describe("estimateSmsSegments", () => {
  it("returns no segments for an empty message", () => {
    expect(estimateSmsSegments("")).toEqual({
      encoding: "GSM-7",
      characters: 0,
      segments: 0,
      units: 0,
      unitsPerSegment: 160,
    });
  });

  it("uses the 160 character GSM-7 single-segment limit", () => {
    expect(estimateSmsSegments("a".repeat(160)).segments).toBe(1);
    expect(estimateSmsSegments("a".repeat(161))).toMatchObject({
      encoding: "GSM-7",
      segments: 2,
      units: 161,
      unitsPerSegment: 153,
    });
  });

  it("counts GSM-7 extension characters as two septets", () => {
    expect(estimateSmsSegments("a".repeat(158) + "^")).toMatchObject({
      encoding: "GSM-7",
      characters: 159,
      segments: 1,
      units: 160,
    });
    expect(estimateSmsSegments("a".repeat(159) + "^")).toMatchObject({
      segments: 2,
      units: 161,
    });
  });

  it("uses the 153-septet limit for concatenated GSM-7 messages", () => {
    expect(estimateSmsSegments("a".repeat(306))).toMatchObject({
      segments: 2,
      units: 306,
      unitsPerSegment: 153,
    });
  });

  it("uses UCS-2 limits for Unicode, counting surrogate pairs as two units", () => {
    expect(estimateSmsSegments("😀".repeat(35))).toMatchObject({
      encoding: "Unicode",
      characters: 35,
      segments: 1,
      units: 70,
      unitsPerSegment: 70,
    });
    expect(estimateSmsSegments("😀".repeat(36))).toMatchObject({
      encoding: "Unicode",
      characters: 36,
      segments: 2,
      units: 72,
      unitsPerSegment: 67,
    });
  });
});
