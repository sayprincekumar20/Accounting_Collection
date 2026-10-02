import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

// Direct read of n8n's Channel Counters Data Table (no workflow execution).
// Same response shape as the old "Channel Counters Webhook (Dashboard)": { counters }.
const CHANNEL_COUNTERS_TABLE_ID = "2PaJlounpgxHtv6J";

interface CounterRow {
  channel?: unknown;
  date?: unknown;
  sent_count?: unknown;
  daily_limit?: unknown;
  last_updated?: unknown;
}
const s = (v: unknown) => (v == null ? "" : String(v));

export const Route = createFileRoute("/api/channel-counters")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const rows = await fetchAllDataTableRows<CounterRow>(CHANNEL_COUNTERS_TABLE_ID);
          const counters = rows.map((r) => ({
            channel: s(r.channel).toLowerCase(),
            date: s(r.date),
            sent_count: Number(r.sent_count || 0),
            daily_limit: Number(r.daily_limit || 50),
            last_updated: s(r.last_updated),
          }));
          return new Response(JSON.stringify({ counters }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[channel-counters] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch channel counters" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
