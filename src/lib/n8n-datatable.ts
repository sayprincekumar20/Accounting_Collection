import { getCloudflareBinding, getEnv } from "@/lib/env";

// Direct calls to n8n's Data Table REST API (/api/v1/data-tables/{id}/rows),
// authenticated with a dedicated read-only N8N_API_KEY. This is a genuine
// REST read against n8n's own database -- it does NOT trigger a workflow
// execution, so it does not count against the n8n Cloud execution quota.
//
// Hardening for production volume (500+ clients):
//  1. Short in-memory cache (per Worker isolate). The same tables (clients,
//     promise_history, escalations) are read by 4-5 routes on every page load;
//     caching them for CACHE_TTL_MS turns ~20 sequential n8n calls per page into
//     a handful, and keeps us well inside Cloudflare's per-request subrequest
//     limit. Concurrent requests for the same table share one in-flight fetch.
//  2. One retry on transient n8n errors (429 / 5xx / network), so a single
//     hiccup no longer turns the whole route into a 500.
//  3. Truncation is never silent: if a table is larger than MAX_PAGES pages,
//     the result is flagged `truncated: true` and a warning is logged (visible
//     in Cloudflare Workers observability). The monthly n8n archive workflow
//     (24_Monthly_Data_Archive) keeps the append-only tables far below this.

const N8N_BASE = "https://rareglobalfood.app.n8n.cloud";
const MAX_PAGE_LIMIT = 250; // n8n's own hard cap per request
const MAX_PAGES = 40; // 40 x 250 = 10,000 rows per table before we flag truncation
const CACHE_TTL_MS = 120_000; // fresh for 2 minutes
// After that, a cached table up to STALE_MAX_MS old is returned IMMEDIATELY while a fresh copy is
// fetched in the background (stale-while-revalidate): pages no longer wait for n8n when this server
// instance has seen the table recently. Writes from the dashboard clear the cache (see below).
const STALE_MAX_MS = 10 * 60_000;

export interface DataTableResult<T> {
  rows: T[];
  truncated: boolean;
}

type CacheEntry = { at: number; value: DataTableResult<unknown> };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DataTableResult<unknown>>>();

async function fetchPage(url: string, apiKey: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "X-N8N-API-KEY": apiKey } });
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

/** Optional: only rows whose `dateColumn` is within the last `sinceDays` days (pages that need recent activity only). */
export interface TableQuery {
  sinceDays?: number | undefined;
  dateColumn?: string | undefined;
}
const keyOf = (dataTableId: string, q: TableQuery = {}) =>
  q.sinceDays ? `${dataTableId}|since:${q.sinceDays}:${q.dateColumn ?? "timestamp"}` : dataTableId;
// Tables whose API rejected the server-side filter: filtered on our side instead.
const noServerFilter = new Set<string>();

async function loadTable<T>(dataTableId: string, q: TableQuery = {}): Promise<DataTableResult<T>> {
  const apiKey = await getEnv("N8N_API_KEY");
  if (!apiKey) throw new Error("N8N_API_KEY is not configured");

  const rows: T[] = [];
  let cursor: string | undefined;
  let truncated = false;
  const column = q.dateColumn ?? "timestamp";
  const sinceIso = q.sinceDays ? new Date(Date.now() - q.sinceDays * 86400000).toISOString() : "";

  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      truncated = true;
      console.warn(
        `[n8n-datatable] table ${dataTableId} has more than ${MAX_PAGES * MAX_PAGE_LIMIT} rows; ` +
          `result truncated. Check that 24_Monthly_Data_Archive is running.`,
      );
      break;
    }
    const params = new URLSearchParams({ limit: String(MAX_PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);
    if (sinceIso && !noServerFilter.has(dataTableId))
      params.set(
        "filter",
        JSON.stringify({
          type: "and",
          filters: [{ columnName: column, condition: "gte", value: sinceIso }],
        }),
      );

    const res = await fetchPage(
      `${N8N_BASE}/api/v1/data-tables/${dataTableId}/rows?${params.toString()}`,
      apiKey,
    );
    if (!res.ok && sinceIso && !noServerFilter.has(dataTableId) && res.status === 400) {
      // The API did not accept the filter: read everything and filter here (same result, slower).
      noServerFilter.add(dataTableId);
      return loadTable<T>(dataTableId, q);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `n8n Data Table API returned ${res.status} for ${dataTableId}: ${body.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as { data: T[]; nextCursor: string | null };
    rows.push(...(json.data || []));
    if (!json.nextCursor) break;
    cursor = json.nextCursor;
  }

  if (sinceIso) {
    const since = new Date(sinceIso).getTime();
    const kept = rows.filter(
      (r) =>
        (new Date(
          String(
            (r as Record<string, unknown>)[column] ??
              (r as Record<string, unknown>)["createdAt"] ??
              "",
          ),
        ).getTime() || 0) >= since,
    );
    rows.length = 0;
    rows.push(...kept);
  }
  return { rows, truncated };
}

// ---- Shared cache (Cloudflare Workers KV, binding DATA_CACHE): one copy for ALL server instances, so a table
// read by one page or user is instant for every other page and user. Optional: without the binding the
// in-memory cache above is used alone. Entries expire after 10 minutes.
interface KvLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
async function kvStore(): Promise<KvLike | null> {
  try {
    const kv = (await getCloudflareBinding("DATA_CACHE")) as KvLike | undefined;
    return kv && typeof kv.get === "function" ? kv : null;
  } catch {
    return null;
  }
}
const kvKey = (key: string) => `dt:${key}`;
async function kvRead(key: string): Promise<CacheEntry | null> {
  const kv = await kvStore();
  if (!kv) return null;
  try {
    const e = (await kv.get(kvKey(key), "json")) as CacheEntry | null;
    return e && typeof e.at === "number" ? e : null;
  } catch {
    return null;
  }
}
async function kvWrite(key: string, entry: CacheEntry): Promise<void> {
  const kv = await kvStore();
  if (!kv) return;
  try {
    await kv.put(kvKey(key), JSON.stringify(entry), { expirationTtl: 600 });
  } catch (err) {
    console.error(`[n8n-datatable] KV write for ${key} failed:`, err);
  }
}
async function kvDeleteTable(dataTableId: string): Promise<void> {
  const kv = await kvStore();
  if (!kv) return;
  // the plain key plus the 'recent rows' variants used by the dashboard
  const keys = [dataTableId, ...RECENT_VARIANTS.map((v) => keyOf(dataTableId, v))];
  await Promise.all(keys.map((k) => kv.delete(kvKey(k)).catch(() => undefined)));
}
/** 'Recent rows' variants used in the code (so writes can clear them from KV too). */
export const RECENT_60_DAYS: TableQuery = { sinceDays: 60, dateColumn: "timestamp" };
const RECENT_VARIANTS: TableQuery[] = [RECENT_60_DAYS, { sinceDays: 90, dateColumn: "timestamp" }];

function startLoad<T>(dataTableId: string, q: TableQuery): Promise<DataTableResult<T>> {
  const key = keyOf(dataTableId, q);
  const p = loadTable<T>(dataTableId, q)
    .then(async (value) => {
      const entry = { at: Date.now(), value };
      cache.set(key, entry);
      await kvWrite(key, entry);
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p as Promise<DataTableResult<unknown>>);
  return p;
}

/**
 * Rows plus a `truncated` flag. Order: this instance's memory -> shared KV -> n8n. Fresh for CACHE_TTL_MS;
 * up to STALE_MAX_MS old the cached copy is returned at once and refreshed in the background.
 * Pass fresh=true to bypass all caches.
 */
export async function fetchDataTable<T = Record<string, unknown>>(
  dataTableId: string,
  opts: { fresh?: boolean } & TableQuery = {},
): Promise<DataTableResult<T>> {
  const q: TableQuery = { sinceDays: opts.sinceDays, dateColumn: opts.dateColumn };
  const key = keyOf(dataTableId, q);
  const now = Date.now();
  const pending = inFlight.get(key) as Promise<DataTableResult<T>> | undefined;
  if (!opts.fresh) {
    let hit = cache.get(key);
    if (!hit || now - hit.at >= CACHE_TTL_MS) {
      const shared = await kvRead(key);
      if (shared && (!hit || shared.at > hit.at)) {
        cache.set(key, shared);
        hit = shared;
      }
    }
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as DataTableResult<T>;
    if (hit && Date.now() - hit.at < STALE_MAX_MS) {
      if (!inFlight.get(key))
        void startLoad<T>(dataTableId, q).catch((err) =>
          console.error(`[n8n-datatable] background refresh of ${key} failed:`, err),
        );
      return hit.value as DataTableResult<T>;
    }
  }
  if (pending) return pending;
  return startLoad<T>(dataTableId, q);
}

/** Backwards-compatible helper used by the existing routes: rows only. */
export async function fetchAllDataTableRows<T = Record<string, unknown>>(
  dataTableId: string,
  opts: { fresh?: boolean } & TableQuery = {},
): Promise<T[]> {
  return (await fetchDataTable<T>(dataTableId, opts)).rows;
}

/** Response headers that surface truncation to anyone inspecting the API. */
export function truncationHeaders(...results: { truncated: boolean }[]): Record<string, string> {
  return results.some((r) => r.truncated) ? { "X-Data-Truncated": "true" } : {};
}

/**
 * Update rows matching `filters` (all must match) in an n8n data table, then clear the read
 * cache for that table. n8n has used both PATCH /rows/update and PATCH /rows for this, so the
 * first is tried and the second used if the first is not found.
 */
export async function updateDataTableRows(
  dataTableId: string,
  filters: { columnName: string; value: string | number | boolean }[],
  data: Record<string, unknown>,
): Promise<void> {
  const apiKey = await getEnv("N8N_API_KEY");
  if (!apiKey) throw new Error("N8N_API_KEY is not configured");
  const body = JSON.stringify({
    filter: {
      type: "and",
      filters: filters.map((f) => ({ columnName: f.columnName, condition: "eq", value: f.value })),
    },
    data,
  });
  const headers = { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" };
  let res = await fetch(`${N8N_BASE}/api/v1/data-tables/${dataTableId}/rows/update`, {
    method: "PATCH",
    headers,
    body,
  });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(`${N8N_BASE}/api/v1/data-tables/${dataTableId}/rows`, {
      method: "PATCH",
      headers,
      body,
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`n8n data table update failed (${res.status}): ${text.slice(0, 300)}`);
  }
  for (const key of [...cache.keys()]) if (key.includes(dataTableId)) cache.delete(key);
  await kvDeleteTable(dataTableId);
}

/** Forget the cached rows of one table, so the next read shows a change made elsewhere. */
export function clearDataTableCache(dataTableId: string): void {
  for (const key of [...cache.keys()]) if (key.includes(dataTableId)) cache.delete(key);
  void kvDeleteTable(dataTableId);
}

/** Insert rows into an n8n data table (used by the assistant's audit log). */
export async function insertDataTableRows(
  dataTableId: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return;
  const apiKey = await getEnv("N8N_API_KEY");
  if (!apiKey) throw new Error("N8N_API_KEY is not configured");
  const res = await fetch(`${N8N_BASE}/api/v1/data-tables/${dataTableId}/rows`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ data: rows, returnType: "count" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`n8n data table insert failed (${res.status}): ${text.slice(0, 300)}`);
  }
  for (const key of [...cache.keys()]) if (key.includes(dataTableId)) cache.delete(key);
  await kvDeleteTable(dataTableId);
}
