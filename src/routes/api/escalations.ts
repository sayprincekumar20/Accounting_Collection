import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

// Direct n8n Data Table REST API call -- replaces the old N8N_WEBHOOK_BASE_URL
// webhook proxy. Pure read, no longer counts against workflow execution quota.

const ESCALATIONS_DATA_TABLE_ID = "ANfkZZDIrDuC4RjK";

interface EscalationTableRow {
  entry_id: string;
  client_id: string;
  client_name: string;
  channel: string;
  reason: string;
  timestamp: string;
}

export const Route = createFileRoute("/api/escalations")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const rows = await fetchAllDataTableRows<EscalationTableRow>(ESCALATIONS_DATA_TABLE_ID);

          const escalations = rows.map((r) => ({
            entry_id: r.entry_id,
            client_id: r.client_id,
            client_name: r.client_name,
            channel: r.channel,
            reason: r.reason,
            recorded_at: r.timestamp,
          }));

          return new Response(JSON.stringify({ escalations }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[escalations] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch escalations" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
