import { afterEach, describe, expect, it, vi } from "vitest";

// The batch check route: /api/dv-batches itself arrives with an empty path (list, start); only
// known paths reach the engine. Engine calls are mocked.
const calls: { path: string; init?: RequestInit; reviewer?: string }[] = [];
vi.mock("../src/lib/dv-engine", async (orig) => ({
  ...(await orig<typeof import("../src/lib/dv-engine")>()),
  dvEngine: async (path: string, init?: RequestInit, reviewer?: string) => {
    calls.push({ path, init, reviewer });
    return new Response("{}", { status: 200 });
  },
}));

type Handler = (ctx: { request: Request; params: { _splat?: string } }) => Promise<Response>;
const route = async () =>
  (
    (await import("../src/routes/api/dv-batches.$.ts")).Route as unknown as {
      options: { server: { handlers: Record<string, Handler> } };
    }
  ).options.server.handlers;
const req = (method: string, reviewer?: string, body?: string) =>
  new Request("https://dash.example/api/dv-batches", {
    method,
    headers: reviewer ? { "X-Reviewer": reviewer } : {},
    ...(body ? { body } : {}),
  });

afterEach(() => {
  calls.length = 0;
});

describe("batch check route", () => {
  it("lists batches at /api/dv-batches (empty path)", async () => {
    const res = await (await route()).GET!({ request: req("GET"), params: { _splat: "" } });
    expect(res.status).toBe(200);
    expect(calls[0]?.path).toBe("/v1/batches");
  });

  it("starts a batch at /api/dv-batches with the reviewer", async () => {
    const body = JSON.stringify({ channel: "General Trade - Traders", size: 4 });
    const res = await (
      await route()
    ).POST!({
      request: req("POST", "Prince", body),
      params: { _splat: "" },
    });
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ path: "/v1/batches", reviewer: "Prince" });
  });

  it("needs a reviewer name to start", async () => {
    const res = await (
      await route()
    ).POST!({ request: req("POST", undefined, "{}"), params: { _splat: "" } });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("passes known paths and refuses others", async () => {
    const h = await route();
    await h.GET!({ request: req("GET"), params: { _splat: "channels" } });
    expect(calls[0]?.path).toBe("/v1/batches/channels");
    const bad = await h.GET!({ request: req("GET"), params: { _splat: "../reviews" } });
    expect(bad.status).toBe(404);
  });
});
