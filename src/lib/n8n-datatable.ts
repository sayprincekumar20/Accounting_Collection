import { getEnv } from "@/lib/env";

// Direct calls to n8n's Data Table REST API (/api/v1/data-tables/{id}/rows),
// authenticated with a dedicated read-only N8N_API_KEY. This is a genuine
// REST read against n8n's own database -- it does NOT trigger a workflow
// execution, unlike the webhook-based routes this replaces. That matters
// because n8n Cloud plans meter workflow executions; a webhook hit for a
// pure data read was consuming that same quota for no benefit. Moving these
// reads here removes them from that quota entirely.

const N8N_BASE = "https://rareglobalfood.app.n8n.cloud";
const MAX_PAGE_LIMIT = 250; // n8n's own hard cap per request

export async function fetchAllDataTableRows<T = Record<string, unknown>>(
  dataTableId: string,
): Promise<T[]> {
  const apiKey = await getEnv("N8N_API_KEY");
  if (!apiKey) throw new Error("N8N_API_KEY is not configured");

  const rows: T[] = [];
  let cursor: string | undefined;

  // Loop through pages until n8n stops returning a nextCursor. In practice
  // these tables are small (dozens to low hundreds of rows), so this is a
  // handful of requests at most, still far cheaper than a workflow execution.
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: String(MAX_PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${N8N_BASE}/api/v1/data-tables/${dataTableId}/rows?${params.toString()}`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`n8n Data Table API returned ${res.status} for ${dataTableId}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data: T[]; nextCursor: string | null };
    rows.push(...(json.data || []));
    if (!json.nextCursor) break;
    cursor = json.nextCursor;
  }

  return rows;
}
