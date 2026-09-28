import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

// Direct n8n Data Table REST API call -- replaces the old N8N_WEBHOOK_BASE_URL
// webhook proxy. Pure read, no longer counts against workflow execution quota.

const PROMISE_HISTORY_DATA_TABLE_ID = "JyGFOqTqI3QXHJbb";

interface PromiseTableRow {
  entry_id: string;
  client_id: string;
  client_name: string;
  channel: string;
  promise_date: string;
  reason: string;
  timestamp: string;
}

export const Route = createFileRoute("/api/promise-history")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const rows = await fetchAllDataTableRows<PromiseTableRow>(PROMISE_HISTORY_DATA_TABLE_ID);

          const promises = rows.map((r) => ({
            entry_id: r.entry_id,
            client_id: r.client_id,
            client_name: r.client_name,
            channel: r.channel,
            promise_date: r.promise_date,
            reason: r.reason,
            recorded_at: r.timestamp,
          }));

          return new Response(JSON.stringify({ promises }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[promise-history] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch promise history" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
