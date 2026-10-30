// src/lib/dv-engine.ts
// SERVER-ONLY. Calls the document verification engine (FastAPI) for the Document Verification
// tab. Settings (Cloudflare -> Workers & Pages -> accounting-collection -> Variables and
// Secrets; locally in .env):
//   DV_ENGINE_URL  e.g. https://dv.rareglobalfood.com
//   DV_API_KEY     the engine's API_KEY (mark as "Encrypt")
// The key never reaches the browser: the page calls /api/dv-reviews..., these routes add it.
import { getEnv } from "@/lib/env";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is acting (typed in the dashboard: the login is shared, so the name comes from the page). */
export function reviewerOf(request: Request): string | undefined {
  const v = (request.headers.get("x-reviewer") || "").trim();
  return v ? v.slice(0, 120) : undefined;
}

export function badRequest(message: string, status = 422): Response {
  return json({ detail: message }, status);
}

export async function dvEngine(
  path: string,
  init: RequestInit = {},
  reviewer?: string,
): Promise<Response> {
  const base = (await getEnv("DV_ENGINE_URL"))?.replace(/\/+$/, "");
  const key = await getEnv("DV_API_KEY");
  if (!base || !key) {
    return json(
      { detail: "The verification engine is not configured (DV_ENGINE_URL / DV_API_KEY)." },
      503,
    );
  }
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", key);
  if (reviewer) headers.set("X-Reviewer", reviewer);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    const r = await fetch(`${base}${path}`, { ...init, headers });
    return new Response(r.body, {
      status: r.status,
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "application/json",
        "Cache-Control": r.headers.get("cache-control") ?? "no-store",
      },
    });
  } catch (err) {
    console.error("[dv-engine] unreachable:", err);
    return json({ detail: "The verification engine could not be reached." }, 502);
  }
}
