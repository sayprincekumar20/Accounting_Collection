import { createFileRoute } from "@tanstack/react-router";
import { computeBatches } from "@/lib/batch-report-server";

// Reports > Approval batch reports: every AR approval batch with each client's outcome.
export const Route = createFileRoute("/api/approval-batches")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { results } = await computeBatches();
          return new Response(
            JSON.stringify({
              batches: results.map((r) => ({
                batch_id: r.batch.batch_id,
                approved_at: r.batch.approved_at,
                approved_by: r.batch.approved_by,
                source: r.batch.source,
                note: r.batch.note,
                label: r.label,
                balance_at_approval: r.batch.balance_at_approval,
                summary: r.summary,
                outcomes: r.outcomes,
              })),
            }),
            { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
          );
        } catch (err) {
          console.error("[approval-batches] error:", err);
          return new Response(JSON.stringify({ error: "Could not load the approval batches" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
