import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate reads the login settings through getEnv(); each test sets them.
let env: Record<string, string | undefined> = {};
vi.mock("../src/lib/env", () => ({ getEnv: async (k: string) => env[k] }));
const { handleAuth } = await import("../src/lib/auth-gate");
const { createSessionToken, SESSION_COOKIE } = await import("../src/lib/auth");

const CFG = {
  DASHBOARD_USER: "team",
  DASHBOARD_PASSWORD: "pw-123",
  DASHBOARD_SESSION_SECRET: "sess-secret",
};
const req = (path: string, init?: RequestInit) => new Request("https://dash.example" + path, init);

describe("login not configured: fail closed", () => {
  beforeEach(() => (env = {}));
  it("blocks pages with 503", async () => {
    const r = await handleAuth(req("/clients"));
    expect(r?.status).toBe(503);
  });
  it("blocks APIs with 503 JSON", async () => {
    const r = await handleAuth(req("/api/clients-list"));
    expect(r?.status).toBe(503);
    expect(r?.headers.get("content-type")).toContain("application/json");
  });
  it("still serves static files", async () => {
    expect(await handleAuth(req("/assets/index-abc.js"))).toBeNull();
  });
});

describe("login configured", () => {
  beforeEach(() => (env = { ...CFG }));
  it("redirects a page without a session to /login", async () => {
    const r = await handleAuth(req("/clients?x=1"));
    expect(r?.status).toBe(303);
    expect(r?.headers.get("location")).toBe("/login?next=%2Fclients%3Fx%3D1");
  });
  it("answers 401 for an API without a session", async () => {
    const r = await handleAuth(req("/api/clients-list"));
    expect(r?.status).toBe(401);
  });
  it("REGRESSION: an API path ending in .json/.txt/.png does NOT skip the login", async () => {
    for (const p of [
      "/api/dv-reviews/abc.json",
      "/api/dv-reviews/x.txt",
      "/api/clients-list.png",
    ]) {
      expect((await handleAuth(req(p)))?.status).toBe(401);
    }
  });
  it("lets /login and static files through", async () => {
    expect(await handleAuth(req("/login"))).toBeNull();
    expect(await handleAuth(req("/favicon.ico"))).toBeNull();
  });
  it("accepts a valid session cookie for pages and APIs", async () => {
    const t = await createSessionToken({
      user: CFG.DASHBOARD_USER,
      password: CFG.DASHBOARD_PASSWORD,
      secret: CFG.DASHBOARD_SESSION_SECRET,
    });
    const headers = { cookie: `${SESSION_COOKIE}=${t}` };
    expect(await handleAuth(req("/clients", { headers }))).toBeNull();
    expect(await handleAuth(req("/api/clients-list", { headers }))).toBeNull();
  });
  it("rejects a session signed with another secret", async () => {
    const t = await createSessionToken({ user: "team", password: "pw-123", secret: "other" });
    expect(
      (
        await handleAuth(
          req("/api/clients-list", { headers: { cookie: `${SESSION_COOKIE}=${t}` } }),
        )
      )?.status,
    ).toBe(401);
  });
  const login = (u: string, p: string, next = "/") => {
    const body = new URLSearchParams({ username: u, password: p, next });
    return req("/api/auth/login", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  };
  it("logs in with the right password (sets a session cookie)", async () => {
    const r = await handleAuth(login("team", "pw-123", "/worklist"));
    expect(r?.status).toBe(303);
    expect(r?.headers.get("location")).toBe("/worklist");
    expect(r?.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
  });
  it("refuses a wrong password (no cookie)", async () => {
    const r = await handleAuth(login("team", "wrong"));
    expect(r?.headers.get("location")).toContain("/login?error=1");
    expect(r?.headers.get("set-cookie")).toBeNull();
  });
  it("never redirects to another site after login", async () => {
    const r = await handleAuth(login("team", "pw-123", "https://evil.example"));
    expect(r?.headers.get("location")).toBe("/");
  });
  it("logout clears the cookie", async () => {
    const r = await handleAuth(req("/api/auth/logout"));
    expect(r?.headers.get("set-cookie")).toMatch(/Max-Age=0|expires=/i);
  });
});
