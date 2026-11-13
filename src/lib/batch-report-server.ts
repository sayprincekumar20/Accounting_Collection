// SERVER-ONLY. Loads everything a batch report needs and computes each client's outcome.
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { vapiFetch } from "@/lib/vapi-server";
import {
  batchClientRows,
  batchLabel,
  batchReportRows,
  clientOutcome,
  companyKey,
  parseBatch,
  summarizeOutcomes,
  type Batch,
  type CallInfo,
  type Cell,
  type ClientOutcome,
} from "./batch-report";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const TABLES = {
  batches: "5N8DS9rNc7blMkfd",
  clients: "rJpqXxmxhqJnlLrJ",
  logs: "a32Z5oGcNi0xzefb",
  conversations: "2WtfkEaHiBSzgItW",
  promises: "JyGFOqTqI3QXHJbb",
  escalations: "ANfkZZDIrDuC4RjK",
  weeklyRemarks: "6YWtxR7cYbBfgkYS",
};

/** Vapi call results (picked up or not) since a date; an unavailable Vapi just means "result not available". */
async function loadCalls(sinceIso: string): Promise<Map<string, CallInfo>> {
  const out = new Map<string, CallInfo>();
  let before: string | undefined;
  for (let page = 0; page < 6; page++) {
    const qs = new URLSearchParams({ limit: "500", createdAtGt: sinceIso });
    if (before) qs.set("createdAtLt", before);
    let calls: Row[] = [];
    try {
      calls = (await vapiFetch<Row[]>(`/call?${qs.toString()}`)) || [];
    } catch (e) {
      console.warn("[batch-report] Vapi calls not available:", String(e).slice(0, 200));
      break;
    }
    for (const c of calls)
      if (c && s(c["id"]))
        out.set(s(c["id"]), { endedReason: s(c["endedReason"]), status: s(c["status"]) });
    if (calls.length < 500) break;
    const oldest = calls.reduce((m, c) => {
      const t = s(c["createdAt"]);
      return t && (!m || t < m) ? t : m;
    }, "");
    if (!oldest || oldest === before) break;
    before = oldest;
  }
  return out;
}

export interface ComputedBatch {
  batch: Batch;
  label: string;
  outcomes: ClientOutcome[];
  summary: ReturnType<typeof summarizeOutcomes>;
}

export async function computeBatches(batchId?: string): Promise<{
  results: ComputedBatch[];
  clients: Map<string, Row>;
}> {
  const [bRows, clientRows, logs, conversations, promises, escalations] = await Promise.all([
    fetchAllDataTableRows<Row>(TABLES.batches),
    fetchAllDataTableRows<Row>(TABLES.clients),
    fetchAllDataTableRows<Row>(TABLES.logs),
    fetchAllDataTableRows<Row>(TABLES.conversations),
    fetchAllDataTableRows<Row>(TABLES.promises).catch(() => [] as Row[]),
    fetchAllDataTableRows<Row>(TABLES.escalations).catch(() => [] as Row[]),
  ]);
  const batches = bRows
    .map(parseBatch)
    .filter((b): b is Batch => !!b)
    .sort((a, b) => b.approved_at.localeCompare(a.approved_at));
  const wanted = batchId ? batches.filter((b) => b.batch_id === batchId) : batches;
  const earliest = wanted.map((b) => b.approved_at).sort()[0];
  const calls = earliest ? await loadCalls(earliest) : new Map<string, CallInfo>();

  // A client is found by its id, or by its company (its contact may have changed since the approval).
  const byId = new Map(clientRows.map((c) => [s(c["client_id"]), c]));
  const byCompany = new Map<string, Row>();
  for (const c of clientRows) {
    if (s(c["status"]).toUpperCase() === "INACTIVE") continue;
    const k = companyKey(c["client_id"]);
    const prev = byCompany.get(k);
    if (!prev || s(c["updatedAt"]) > s(prev["updatedAt"])) byCompany.set(k, c);
  }
  const clients = new Map<string, Row>();
  const results = wanted.map((batch) => {
    const outcomes = batch.clients.map((bc) => {
      const own = byId.get(bc.client_id);
      const client =
        own && s(own["status"]).toUpperCase() !== "INACTIVE"
          ? own
          : (byCompany.get(companyKey(bc.client_id)) ?? own);
      if (client) clients.set(bc.client_id, client);
      return clientOutcome({
        batch,
        bc,
        batches,
        client,
        logs,
        conversations,
        promises,
        escalations,
        calls,
      });
    });
    return { batch, label: batchLabel(batch), outcomes, summary: summarizeOutcomes(outcomes) };
  });
  return { results, clients };
}

/** The Excel content of one batch (two sheets), built on the server; the browser only writes the file. */
export async function batchWorkbook(batchId: string): Promise<{
  file_name: string;
  sheets: { name: string; rows: Cell[][]; headerRow: number; boldRows: number; widths: number[] }[];
} | null> {
  const { results, clients } = await computeBatches(batchId);
  const r = results[0];
  if (!r) return null;
  const weeklyRemarks = await fetchAllDataTableRows<Row>(TABLES.weeklyRemarks).catch(
    () => [] as Row[],
  );
  const report = batchReportRows({ batch: r.batch, outcomes: r.outcomes, clients, weeklyRemarks });
  const widths = [
    16, 16, 10, 34, 30, 14, 11, 12, 11, 13, 13, 11, 12, 12, 12, 12, 12, 26, 40, 26, 12, 40, 24, 14,
    16, 18, 22, 8, 36, 10, 16, 40, 34, 14, 14, 14, 14, 26,
  ];
  const who = r.batch.approved_by.replace(/[^\w .-]/g, "").trim() || "AR";
  return {
    file_name: `Batch report - ${r.label.replace(/:/g, "")} - ${who}.xlsx`,
    sheets: [
      { name: "Report", rows: report, headerRow: 7, boldRows: 6, widths },
      {
        name: "Clients",
        rows: batchClientRows(r.batch, r.outcomes),
        headerRow: 0,
        boldRows: 0,
        widths: [34, 20, 12, 22, 16, 60, 18, 50, 10, 16, 60, 40, 12, 40, 14, 14, 14, 14, 24, 26],
      },
    ],
  };
}
