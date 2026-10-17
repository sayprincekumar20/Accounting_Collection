import { getEnv } from "@/lib/env";

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
const CACHE_TTL_MS = 30_000;

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

async function loadTable<T>(dataTableId: string): Promise<DataTableResult<T>> {
  const apiKey = await getEnv("N8N_API_KEY");
  if (!apiKey) throw new Error("N8N_API_KEY is not configured");

  const rows: T[] = [];
  let cursor: string | undefined;
  let truncated = false;

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

    const res = await fetchPage(
      `${N8N_BASE}/api/v1/data-tables/${dataTableId}/rows?${params.toString()}`,
      apiKey,
    );
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

  return { rows, truncated };
}

/** Rows plus a `truncated` flag. Cached for CACHE_TTL_MS; pass fresh=true to bypass the cache. */
export async function fetchDataTable<T = Record<string, unknown>>(
  dataTableId: string,
  opts: { fresh?: boolean } = {},
): Promise<DataTableResult<T>> {
  const now = Date.now();
  const hit = cache.get(dataTableId);
  if (!opts.fresh && hit && now - hit.at < CACHE_TTL_MS) {
    return hit.value as DataTableResult<T>;
  }
  const pending = inFlight.get(dataTableId);
  if (pending) return pending as Promise<DataTableResult<T>>;

  const p = loadTable<T>(dataTableId)
    .then((value) => {
      cache.set(dataTableId, { at: Date.now(), value });
      return value;
    })
    .finally(() => inFlight.delete(dataTableId));
  inFlight.set(dataTableId, p as Promise<DataTableResult<unknown>>);
  return p;
}

/** Backwards-compatible helper used by the existing routes: rows only. */
export async function fetchAllDataTableRows<T = Record<string, unknown>>(
  dataTableId: string,
  opts: { fresh?: boolean } = {},
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
}
