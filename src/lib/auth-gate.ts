// Login gate for every request: session cookie check, login / logout, fail-closed when the login
// settings are missing. Kept separate from server.ts so it can be unit-tested.
import { getEnv } from "./env";
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
} from "./auth";

export const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
// Static files (built assets, icons) load without a session. Never for /api/ paths: an API route with an
// ID in the path (e.g. /api/dv-reviews/<id>) must not skip the login just because the ID ends in ".json".
export const isStaticAsset = (path: string) =>
  !path.startsWith("/api/") &&
  /\.(js|css|map|png|jpe?g|svg|ico|webp|gif|woff2?|ttf|txt|json)$/i.test(path);

function isProviderMediaFetch(request: Request, path: string) {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    /^\/api\/outbound-media\/[a-f0-9]{64}$/.test(path)
  );
}

export async function handleAuth(request: Request): Promise<Response | null> {
  // Read the login settings the same way as every other secret (getEnv: the server environment).
  const cfg = authConfig({
    DASHBOARD_USER: await getEnv("DASHBOARD_USER"),
    DASHBOARD_PASSWORD: await getEnv("DASHBOARD_PASSWORD"),
    DASHBOARD_SESSION_SECRET: await getEnv("DASHBOARD_SESSION_SECRET"),
  });
  const url = new URL(request.url);
  const path = url.pathname;
  if (cfg && isProviderMediaFetch(request, path)) return null;
  if (!cfg) {
    // Fail closed: without DASHBOARD_USER / DASHBOARD_PASSWORD / DASHBOARD_SESSION_SECRET nobody can sign in,
    // so nothing but static files is served (previously the dashboard stayed open without a login).
    if (isStaticAsset(path)) return null;
    const body =
      "Dashboard login is not configured. Access is blocked until DASHBOARD_USER, DASHBOARD_PASSWORD and DASHBOARD_SESSION_SECRET are set.";
    return path.startsWith("/api/")
      ? new Response(JSON.stringify({ error: body }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      : new Response(body, {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
  }

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
