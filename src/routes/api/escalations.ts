import { getEnv } from "@/lib/env";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/escalations")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const res = await fetch(`${await getEnv("N8N_WEBHOOK_BASE_URL")}/escalations-list`);
          const body = await res.text();
          return new Response(body, {
            status: res.status,
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
