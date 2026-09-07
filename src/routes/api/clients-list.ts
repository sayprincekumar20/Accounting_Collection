import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/clients-list")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const res = await fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/clients-list`);
          const body = await res.text();
          return new Response(body, {
            status: res.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[clients-list] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch clients" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
