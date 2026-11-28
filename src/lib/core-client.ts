// SERVER-ONLY. Client of the new backend (core/), which replaces the n8n workflows wave by wave.
//
// Nothing changes until CORE_URL and CORE_API_KEY are set. Even then every action is routed by its SWITCH
// (wave1.approvals ...): "n8n" = today's path, "shadow" = n8n as today plus a dry run in the backend that
// changes nothing, "core" = the backend does it. Anything unexpected (not configured, backend down, unknown switch)
// means "n8n", so the dashboard keeps working exactly as before.
import { getEnv } from "@/lib/env";

export type SwitchMode = "n8n" | "shadow" | "core";

const SWITCH_TTL_MS = 15_000;
const switchCache = new Map<string, { at: number; mode: SwitchMode }>();

export async function coreConfig(): Promise<{ url: string; key: string } | null> {
  const url = (await getEnv("CORE_URL"))?.trim().replace(/\/+$/, "");
  const key = (await getEnv("CORE_API_KEY"))?.trim();
  return url && key ? { url, key } : null;
}

export function clearSwitchCache(): void {
  switchCache.clear();
}

/** The mode of one switch; "n8n" whenever it cannot be read. Read once per 15 seconds for all switches. */
export async function switchMode(key: string, now = Date.now()): Promise<SwitchMode> {
  const cfg = await coreConfig();
  if (!cfg) return "n8n";
  const hit = switchCache.get(key);
  if (hit && now - hit.at < SWITCH_TTL_MS) return hit.mode;
  try {
    const res = await fetch(`${cfg.url}/v1/switches`, {
      headers: { "X-API-Key": cfg.key },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`switches ${res.status}`);
    const body = (await res.json()) as { items?: { key: string; mode: string }[] };
    for (const item of body.items ?? [])
      switchCache.set(item.key, {
        at: now,
        mode: item.mode === "core" || item.mode === "shadow" ? item.mode : "n8n",
      });
  } catch (err) {
    console.warn("[core] switches unreadable, staying on n8n:", String(err).slice(0, 120));
  }
  if (!switchCache.has(key) || now - (switchCache.get(key)?.at ?? 0) >= SWITCH_TTL_MS)
    switchCache.set(key, { at: now, mode: "n8n" });
  return switchCache.get(key)!.mode;
}

/** A call to the backend as the person who is acting (their name is stamped on audit lines and approvals). */
export async function coreFetch(
  path: string,
  init: { method: "GET" | "POST" | "PUT"; body?: unknown; actor: string; timeoutMs?: number },
): Promise<Response> {
  const cfg = await coreConfig();
  if (!cfg) throw new Error("CORE_URL / CORE_API_KEY are not configured");
  return fetch(`${cfg.url}${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": cfg.key,
      "X-Acting-User": encodeURIComponent(init.actor),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
}
