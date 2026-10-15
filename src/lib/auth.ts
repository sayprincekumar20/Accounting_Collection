// Single shared login for the dashboard (one ID + password, set as Cloudflare secrets:
// DASHBOARD_USER, DASHBOARD_PASSWORD, optional DASHBOARD_SESSION_SECRET).
// Sessions are a signed cookie (HMAC-SHA256), so no database is needed.

export const SESSION_COOKIE = "rgf_session";
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, in seconds

export interface AuthConfig {
  user: string;
  password: string;
  secret: string;
}

/** Reads the login settings from the Worker env. Returns null when no password is set (login off). */
export function authConfig(env: unknown): AuthConfig | null {
  const e = (env || {}) as Record<string, unknown>;
  const password = String(e["DASHBOARD_PASSWORD"] || "");
  if (!password) return null;
  const user = String(e["DASHBOARD_USER"] || "admin");
  const secret = String(e["DASHBOARD_SESSION_SECRET"] || "") || `rgf-dashboard::${user}::${password}`;
  return { user, password, secret };
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time string comparison (avoids leaking how many characters matched). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function createSessionToken(cfg: AuthConfig): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ u: cfg.user, exp: Date.now() + SESSION_MAX_AGE * 1000 })));
  return `${payload}.${await sign(cfg.secret, payload)}`;
}

export async function isValidSession(token: string | undefined, cfg: AuthConfig): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!safeEqual(sig, await sign(cfg.secret, payload))) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { u?: string; exp?: number };
    return json.u === cfg.user && typeof json.exp === "number" && json.exp > Date.now();
  } catch {
    return false;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Only allow redirects back into this dashboard (no open redirect). */
export function safeNext(next: string | null | undefined): string {
  const n = String(next || "/");
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/api/") ? n : "/";
}
