import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/env", () => ({
  getEnv: async () => "test-key",
}));

const rowsAll = [
  { id: 1, timestamp: "2026-06-01T00:00:00Z" }, // old (> 60 days before 2026-11-10)
  { id: 2, timestamp: "2026-11-09T00:00:00Z" }, // recent
];

describe("recent rows and paging", () => {
  let urls: string[] = [];
  let rejectFilter = false;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
    urls = [];
    rejectFilter = false;
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

  it("a second read within 2 minutes is served from this server's memory (no n8n call)", async () => {
    const mod = await import("../src/lib/n8n-datatable");
    await mod.fetchAllDataTableRows("CLIENTS");
    await mod.fetchAllDataTableRows("CLIENTS");
    expect(urls).toHaveLength(1);
    mod.clearDataTableCache("CLIENTS"); // a write elsewhere clears it
    await mod.fetchAllDataTableRows("CLIENTS");
    expect(urls).toHaveLength(2);
  });
});
