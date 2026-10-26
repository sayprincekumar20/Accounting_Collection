import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { getEnv } from "./lib/env";
import {
  authConfig,
  clearedSessionCookie,
  createSessionToken,
  isValidSession,
  readCookie,
  safeEqual,
  safeNext,
  SESSION_COOKIE,
  sessionCookie,
} from "./lib/auth";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Login gate (single shared ID + password). Off until DASHBOARD_PASSWORD is set in Cloudflare.
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
const isStaticAsset = (path: string) =>
  /\.(js|css|map|png|jpe?g|svg|ico|webp|gif|woff2?|ttf|txt|json)$/i.test(path);

async function handleAuth(request: Request): Promise<Response | null> {
  // Read the login settings the same way as every other secret (cloudflare:workers env binding):
  // the framework runtime does not pass Cloudflare's env to this fetch handler.
  const cfg = authConfig({
    DASHBOARD_USER: await getEnv("DASHBOARD_USER"),
    DASHBOARD_PASSWORD: await getEnv("DASHBOARD_PASSWORD"),
    DASHBOARD_SESSION_SECRET: await getEnv("DASHBOARD_SESSION_SECRET"),
  });
  if (!cfg) return null; // login not configured yet: dashboard stays open as before
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/auth/login" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const user = String(form?.get("username") || "").trim();
    const pass = String(form?.get("password") || "");
    const next = safeNext(String(form?.get("next") || "/"));
    if (safeEqual(user, cfg.user) && safeEqual(pass, cfg.password)) {
      return new Response(null, {
        status: 303,
        headers: { location: next, "set-cookie": sessionCookie(await createSessionToken(cfg)) },
      });
    }
    return new Response(null, {
      status: 303,
      headers: { location: `/login?error=1&next=${encodeURIComponent(next)}` },
    });
  }
  if (path === "/api/auth/logout") {
    return new Response(null, {
      status: 303,
      headers: { location: "/login", "set-cookie": clearedSessionCookie() },
    });
  }
  if (PUBLIC_PATHS.has(path) || isStaticAsset(path)) return null;

  if (await isValidSession(readCookie(request, SESSION_COOKIE), cfg)) return null;

  if (path.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(null, {
    status: 303,
    headers: { location: `/login?next=${encodeURIComponent(path + url.search)}` },
  });
}

// Shared 2-minute cache for the slow list APIs that call outside services (Gmail, Vapi, Telerivet,
// Twilio). Cloudflare's Cache API is shared by all servers in a location, unlike in-memory caches.
// Only reached after the login check; '?fresh=1' bypasses it; only successful responses are stored.
const SHARED_CACHE_PATHS = new Set([
  "/api/gmail-threads-list",
  "/api/vapi-calls-list",
  "/api/sms-conversations",
  "/api/whatsapp-conversations",
]);
const SHARED_CACHE_SECONDS = 120;
function sharedCacheKey(request: Request): Request | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (!SHARED_CACHE_PATHS.has(url.pathname) || url.searchParams.get("fresh") === "1") return null;
  return new Request(url.toString(), { method: "GET" });
}
function edgeCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return (c && c.default) || null;
}
async function readSharedCache(request: Request): Promise<Response | null> {
  try {
    const key = sharedCacheKey(request);
    const cache = edgeCache();
    if (!key || !cache) return null;
    return (await cache.match(key)) || null;
  } catch {
    return null;
  }
}
async function writeSharedCache(request: Request, response: Response): Promise<void> {
  try {
    const key = sharedCacheKey(request);
    const cache = edgeCache();
    if (!key || !cache || response.status !== 200) return;
    const copy = new Response(response.clone().body, response);
    copy.headers.set("Cache-Control", `public, max-age=${SHARED_CACHE_SECONDS}`);
    await cache.put(key, copy);
  } catch {
    // caching is best-effort
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const authResponse = await handleAuth(request);
      if (authResponse) return authResponse;
      const handler = await getServerEntry();
      const cached = await readSharedCache(request);
      if (cached) return cached;
      const response = await handler.fetch(request, env, ctx);
      await writeSharedCache(request, response);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
