import { describe, expect, it, vi } from "vitest";

// Regression: the framework calls the server entry as fetch(request) with NO env and NO ctx. A line that read
// `ctx.waitUntil` threw on every request, so every page showed "This page didn't load".
vi.mock("../src/lib/error-capture", () => ({ consumeLastCapturedError: () => undefined }));
vi.mock("../src/lib/auth-gate", () => ({ handleAuth: async () => null }));
vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: async () => new Response("page ok", { status: 200 }) },
}));

import server from "../src/server";

describe("server entry", () => {
  it("serves a page when called without env and ctx (as the framework does)", async () => {
    const res = await (server.fetch as (r: Request) => Promise<Response>)(
      new Request("http://localhost/"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("page ok");
  });

  it("uses ctx.waitUntil for the cache write when it exists", async () => {
    const waitUntil = vi.fn();
    const res = await server.fetch(
      new Request("http://localhost/api/channel-counters"),
      {},
      { waitUntil },
    );
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("falls back to the error page only for a real failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@tanstack/react-start/server-entry", () => ({
      default: {
        fetch: async () => {
          throw new Error("boom");
        },
      },
    }));
    vi.resetModules();
    const failing = (await import("../src/server")).default;
    const res = await (failing.fetch as (r: Request) => Promise<Response>)(
      new Request("http://localhost/"),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("This page didn't load");
  });
});
