import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/daily-run-logs")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const res = await fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/daily-run-logs-list`);
          const body = await res.text();
          return new Response(body, {
            status: res.status,
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
