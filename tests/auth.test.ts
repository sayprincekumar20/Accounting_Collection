import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authConfig,
  createSessionToken,
  isValidSession,
  safeEqual,
  safeNext,
} from "../src/lib/auth";

describe("authConfig", () => {
  it("is null when no password is set (login not configured)", () => {
    expect(authConfig({})).toBeNull();
    expect(authConfig({ DASHBOARD_USER: "x" })).toBeNull();
  });
  it("reads user, password and secret", () => {
    expect(
      authConfig({ DASHBOARD_USER: "u", DASHBOARD_PASSWORD: "p", DASHBOARD_SESSION_SECRET: "s" }),
    ).toEqual({ user: "u", password: "p", secret: "s" });
  });
});

describe("safeEqual", () => {
  it("compares exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("safeNext (no open redirect after login)", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/clients")).toBe("/clients");
    expect(safeNext("/clients?x=1")).toBe("/clients?x=1");
  });
  it("rejects other sites and protocol-relative URLs", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/api/clients-list",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(bad as string)).toBe("/");
    }
  });
});

describe("session tokens", () => {
  const cfg = { user: "u", password: "p", secret: "secret-1" };
  afterEach(() => vi.useRealTimers());
  it("accepts a fresh token", async () => {
    expect(await isValidSession(await createSessionToken(cfg), cfg)).toBe(true);
  });
  it("rejects a tampered token, another secret, or no token", async () => {
    const t = await createSessionToken(cfg);
    expect(await isValidSession(t.slice(0, -2) + (t.endsWith("A") ? "BB" : "AA"), cfg)).toBe(false);
    expect(await isValidSession(t, { ...cfg, secret: "secret-2" })).toBe(false);
    expect(await isValidSession(undefined, cfg)).toBe(false);
    expect(await isValidSession("garbage", cfg)).toBe(false);
  });
  it("expires after the session lifetime (7 days)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const t = await createSessionToken(cfg);
    vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
    expect(await isValidSession(t, cfg)).toBe(false);
  });
});
