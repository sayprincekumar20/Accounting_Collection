import { createFileRoute } from "@tanstack/react-router";
import { fetchDataTable, truncationHeaders } from "@/lib/n8n-datatable";

// Direct read of n8n's Reminder Queue Data Table (no workflow execution, so it
// does not count against the n8n Cloud execution quota). Same response shape as
// the old "Reminder Queue Webhook (Dashboard)" workflow: { queue }, newest first.
const REMINDER_QUEUE_TABLE_ID = "LixqhIFzsJKk3dll";

interface QueueRow {
  queue_id?: unknown;
  client_id?: unknown;
  client_name?: unknown;
  contact_person?: unknown;
  preferred_channel?: unknown;
  queue_status?: unknown;
  fallback_channel?: unknown;
  fallback_status?: unknown;
  collection_amount?: unknown;
  due_date?: unknown;
  invoice_numbers?: unknown;
  created_date?: unknown;
  attempted_date?: unknown;
  sent_date?: unknown;
  trigger_source?: unknown;
  requested_by?: unknown;
}
const s = (v: unknown) => (v == null ? "" : String(v));

export const Route = createFileRoute("/api/reminder-queue-list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const fresh = new URL(request.url).searchParams.get("fresh") === "1";
          const [result, clientsRes] = await Promise.all([
            fetchDataTable<QueueRow>(REMINDER_QUEUE_TABLE_ID, { fresh }),
            fetchDataTable<Record<string, unknown>>("rJpqXxmxhqJnlLrJ", { fresh }).catch(
              () => null,
            ),
          ]);
          const rows = result.rows;
          // A queue row whose client row is retired (INACTIVE after a contact change or regrouping under
          // the CRM parent) or gone is never sent: show it as STALE so the counts match the Clients tab.
          const activeIds = clientsRes
            ? new Set(
                clientsRes.rows
                  .filter((c) => s(c["status"]).toUpperCase() !== "INACTIVE")
                  .map((c) => s(c["client_id"])),
              )
            : null;
          const queue = rows.map((r) => ({
            queue_id: s(r.queue_id),
            client_id: s(r.client_id),
            client_name: s(r.client_name),
            contact_person: s(r.contact_person),
            preferred_channel: s(r.preferred_channel),
            queue_status: activeIds && !activeIds.has(s(r.client_id)) ? "STALE" : s(r.queue_status),
            fallback_channel: s(r.fallback_channel),
            fallback_status: s(r.fallback_status),
            collection_amount: Number(r.collection_amount || 0),
            due_date: s(r.due_date),
            invoice_numbers: s(r.invoice_numbers),
            created_date: s(r.created_date),
            attempted_date: s(r.attempted_date),
            sent_date: s(r.sent_date),
            trigger_source: s(r.trigger_source),
            requested_by: s(r.requested_by),
          }));
          queue.sort(
            (a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime(),
          );
          return new Response(JSON.stringify({ queue, truncated: result.truncated }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...truncationHeaders(result),
            },
          });
        } catch (err) {
          console.error("[reminder-queue-list] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch reminder queue" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
