import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

// Direct read of n8n's Daily Run Log Data Table (no workflow execution).
// Same response shape as the old "Daily Run Logs Webhook (Dashboard)": { runs }, newest first.
const DAILY_RUN_LOG_TABLE_ID = "BVGj7FvvvVsg1QxY";

interface RunLogRow {
  run_date?: unknown;
  run_timestamp?: unknown;
  total_processed?: unknown;
  total_outstanding?: unknown;
  email_queued?: unknown;
  viber_queued?: unknown;
  no_contact_count?: unknown;
  no_contact_amount?: unknown;
  email_only_count?: unknown;
  email_only_amount?: unknown;
  skipped_cooldown?: unknown;
}
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v || 0);

export const Route = createFileRoute("/api/daily-run-logs")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const rows = await fetchAllDataTableRows<RunLogRow>(DAILY_RUN_LOG_TABLE_ID);
          const runs = rows.map((r) => ({
            run_date: s(r.run_date),
            run_timestamp: s(r.run_timestamp),
            total_processed: n(r.total_processed),
            total_outstanding: n(r.total_outstanding),
            email_queued: n(r.email_queued),
            viber_queued: n(r.viber_queued),
            no_contact_count: n(r.no_contact_count),
            no_contact_amount: n(r.no_contact_amount),
            email_only_count: n(r.email_only_count),
            email_only_amount: n(r.email_only_amount),
            skipped_cooldown: n(r.skipped_cooldown),
          }));
          runs.sort((a, b) => new Date(b.run_date).getTime() - new Date(a.run_date).getTime());
          return new Response(JSON.stringify({ runs }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[daily-run-logs] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch daily run logs" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
