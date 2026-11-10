import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/n8n-datatable", () => ({
  fetchAllDataTableRows: async () => [],
  RECENT_60_DAYS: {},
}));
const { mapWithLimit } = await import("../src/routes/api/gmail-threads-list");

describe("mapWithLimit (parallel Gmail chunk searches)", () => {
  it("runs at most N at once and keeps the input order", async () => {
    let running = 0;
    let peak = 0;
    const delays = [40, 5, 30, 1, 20, 10, 2];
    const out = await mapWithLimit(delays, 4, async (d) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, d));
      running--;
      return d * 2;
    });
    expect(out).toEqual(delays.map((d) => d * 2));
    expect(peak).toBe(4);
  });
  it("handles an empty list", async () => {
    expect(await mapWithLimit([], 4, async (x: number) => x)).toEqual([]);
  });
});
