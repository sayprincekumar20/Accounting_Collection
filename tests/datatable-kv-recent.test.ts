import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kvData = new Map<string, string>();
const fakeKv = {
  get: async (k: string) => (kvData.has(k) ? JSON.parse(kvData.get(k)!) : null),
  put: async (k: string, v: string) => void kvData.set(k, v),
  delete: async (k: string) => void kvData.delete(k),
};
let kvBound = true;
vi.mock("../src/lib/env", () => ({
  getEnv: async () => "test-key",
  getCloudflareBinding: async (name: string) =>
    name === "DATA_CACHE" && kvBound ? fakeKv : undefined,
}));

const rowsAll = [
  { id: 1, timestamp: "2026-06-01T00:00:00Z" }, // old (> 60 days before 2026-11-10)
  { id: 2, timestamp: "2026-11-09T00:00:00Z" }, // recent
];

describe("recent rows and the shared KV cache", () => {
  let urls: string[] = [];
  let rejectFilter = false;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    urls = [];
    rejectFilter = false;
    kvData.clear();
    kvBound = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (rejectFilter && url.includes("filter="))
          return new Response("bad filter", { status: 400 });
        return new Response(JSON.stringify({ data: rowsAll, nextCursor: null }), { status: 200 }); // ignores the filter
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reads the table without a server filter and keeps only recent rows (filtered locally)", async () => {
    const mod = await import("../src/lib/n8n-datatable");
    const rows = await mod.fetchAllDataTableRows<{ id: number }>("LOGS", mod.RECENT_60_DAYS);
    expect(rows.map((r) => r.id)).toEqual([2]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain("filter=");
  });

  it("stops paging when the API repeats the same cursor (no endless loop)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            data: [{ id: urls.length, timestamp: "2026-11-09T00:00:00Z" }],
            nextCursor: "SAME",
          }),
          { status: 200 },
        );
      }),
    );
    const mod = await import("../src/lib/n8n-datatable");
    const rows = await mod.fetchAllDataTableRows("LOOPY");
    expect(urls.length).toBe(2); // first page + one page with the repeated cursor, then stop
    expect(rows.length).toBe(2);
  });

  // Skipped while the shared KV cache is switched off (hotfix, KV_ENABLED = false in n8n-datatable.ts).
  it.skip("a new server instance reads the table from KV without calling n8n; a write clears KV", async () => {
    const first = await import("../src/lib/n8n-datatable");
    await first.fetchAllDataTableRows("CLIENTS");
    expect(urls.length).toBe(1);
    expect(kvData.has("dt:CLIENTS")).toBe(true);
    vi.resetModules(); // new instance: empty memory
    const second = await import("../src/lib/n8n-datatable");
    const rows = await second.fetchAllDataTableRows<{ id: number }>("CLIENTS");
    expect(rows.length).toBe(2);
    expect(urls.length).toBe(1); // served from KV
    second.clearDataTableCache("CLIENTS");
    await vi.waitFor(() => expect(kvData.has("dt:CLIENTS")).toBe(false));
  });
});

describe("KV write limit (free plan: at most one write per table every 10 minutes)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  // Skipped while the shared KV cache is switched off (hotfix).
  it.skip("skips KV writes within 10 minutes of the last one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    kvData.clear();
    kvBound = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 1 }], nextCursor: null }), { status: 200 }),
      ),
    );
    const mod = await import("../src/lib/n8n-datatable");
    await mod.fetchAllDataTableRows("T9", { fresh: true });
    const firstAt = JSON.parse(kvData.get("dt:T9")!).at;
    vi.setSystemTime(new Date("2026-11-10T00:05:00Z"));
    await mod.fetchAllDataTableRows("T9", { fresh: true });
    expect(JSON.parse(kvData.get("dt:T9")!).at).toBe(firstAt); // not rewritten after 5 min
    vi.setSystemTime(new Date("2026-11-10T00:11:00Z"));
    await mod.fetchAllDataTableRows("T9", { fresh: true });
    expect(JSON.parse(kvData.get("dt:T9")!).at).toBeGreaterThan(firstAt); // rewritten after 11 min
  });
});
