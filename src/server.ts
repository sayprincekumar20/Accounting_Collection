import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleAuth } from "./lib/auth-gate";

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

// Shared 2-minute cache for slow list APIs. Cloudflare's Cache API is shared by all servers in a
// location, unlike in-memory caches. Only reached after the login check; '?fresh=1' bypasses it;
// only successful responses are stored.
const SHARED_CACHE_PATHS = new Set([
  "/api/gmail-threads-list",
  "/api/reminder-queue-list",
  "/api/channel-counters",
  "/api/vapi-calls-list",
  "/api/sms-conversations",
  "/api/whatsapp-conversations",
  "/api/viber-conversations",
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
  // The framework calls this handler as fetch(request) only: `env` and `ctx` can be undefined.
  async fetch(
    request: Request,
    env?: unknown,
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void },
  ) {
    try {
      const authResponse = await handleAuth(request);
      if (authResponse) return authResponse;
      const handler = await getServerEntry();
      const cached = await readSharedCache(request);
      if (cached) return cached;
      const response = await handler.fetch(request, env, ctx);
      const cacheWrite = writeSharedCache(request, response);
      if (ctx?.waitUntil) ctx.waitUntil(cacheWrite);
      else await cacheWrite;
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
