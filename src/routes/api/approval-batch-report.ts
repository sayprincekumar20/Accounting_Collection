import { createFileRoute } from "@tanstack/react-router";
import { batchWorkbook } from "@/lib/batch-report-server";

// The Excel content of one approval batch (the browser writes the .xlsx file).
export const Route = createFileRoute("/api/approval-batch-report")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("batch_id") || "";
        try {
          const wb = id ? await batchWorkbook(id) : null;
          if (!wb)
            return new Response(JSON.stringify({ error: "Batch not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          return new Response(JSON.stringify(wb), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[approval-batch-report] error:", err);
          return new Response(JSON.stringify({ error: "Could not build the batch report" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
