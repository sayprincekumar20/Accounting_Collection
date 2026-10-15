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
          // The stored daily counters undercount when several sends run at once (read-then-write race),
          // so "sent today" is counted from the message log since 00:00 Manila instead.
          const logs = await fetchAllDataTableRows<Record<string, unknown>>("a32Z5oGcNi0xzefb").catch(() => []);
          const now = new Date();
          const manilaMidnight = new Date(
            new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) + "T00:00:00+08:00",
          ).getTime();
          const sentToday: Record<string, number> = {};
          for (const l of logs) {
            const t = new Date(String(l["timestamp"] || l["createdAt"] || "")).getTime() || 0;
            if (t < manilaMidnight) continue;
            const ch = String(l["channel"] || "").toUpperCase();
            const ev = String(l["event_type"] || "").toUpperCase();
            if (ev === "SEND_SUCCESS" || (ch === "VOICE" && ev === "CALL_INITIATED")) sentToday[ch] = (sentToday[ch] || 0) + 1;
          }
          const counters = rows.map((r) => ({
            channel: s(r.channel).toLowerCase(),
            date: s(r.date),
            counter_sent_count: Number(r.sent_count || 0),
            sent_count: sentToday[s(r.channel).toUpperCase()] ?? Number(r.sent_count || 0),
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
