import { createFileRoute } from "@tanstack/react-router";
import { buildReview, sanitizeRows } from "@/lib/assistant/list-server";

// AI assistant contact lists, step 1: match the customer names of an uploaded sheet to our clients and return the
// review table (status, flags, overdue and current invoices per client). Read-only: nothing is sent or changed.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/assistant/list-match")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const b = (await request.json()) as { rows?: unknown };
          const rows = sanitizeRows(b.rows);
          if (!rows.length) return json({ error: "No customer names to match." }, 400);
          return json(await buildReview(rows));
        } catch (err) {
          console.error("[assistant-list-match] error:", err);
          return json(
            { error: "Failed to match the list", detail: String(err).slice(0, 300) },
            500,
          );
        }
      },
    },
  },
});
