import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/env", () => ({ getEnv: async () => "test-key" }));

describe("n8n data table cache (fresh 2 min, then stale-while-revalidate)", () => {
  let calls = 0;
  let version = 1;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    calls = 0;
    version = 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response(JSON.stringify({ data: [{ id: 1, v: version }], nextCursor: null }), {
          status: 200,
        });
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("serves from cache, answers stale data instantly while refreshing, and reads fresh after a write", async () => {
    const mod = await import("../src/lib/n8n-datatable");
    const read = async () =>
      ((await mod.fetchAllDataTableRows<{ v: number }>("T1"))[0] ?? { v: -1 }).v;
    expect(await read()).toBe(1);
    expect(calls).toBe(1);

    vi.setSystemTime(new Date("2026-11-10T00:01:00Z")); // 1 min: fresh, no n8n call
    expect(await read()).toBe(1);
    expect(calls).toBe(1);

    version = 2;
    vi.setSystemTime(new Date("2026-11-10T00:03:00Z")); // 3 min: stale -> instant old value + background refresh
    expect(await read()).toBe(1);
    await vi.waitFor(() => expect(calls).toBe(2)); // background refresh started
    await vi.waitFor(async () => expect(await read()).toBe(2)); // refreshed copy replaces the old one
    const afterRefresh = calls;

    version = 3;
    mod.clearDataTableCache("T1"); // what every dashboard write does
    expect(await read()).toBe(3); // waits for fresh data
    expect(calls).toBe(afterRefresh + 1);
  });
});
