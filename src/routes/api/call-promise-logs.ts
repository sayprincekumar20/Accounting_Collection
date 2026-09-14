import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/call-promise-logs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const callId = url.searchParams.get("callId");
          if (!callId) {
            return new Response(JSON.stringify({ error: "callId is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const res = await fetch(
            `${process.env["N8N_WEBHOOK_BASE_URL"]}/call-promise-logs?callId=${encodeURIComponent(callId)}`,
          );
          
          // If 404, return empty logs instead of error
          if (res.status === 404) {
            return new Response(JSON.stringify({ logs: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            });
          }
          
          const body = await res.text();
          return new Response(body, {
            status: res.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[call-promise-logs] fetch error:", err);
          return new Response(JSON.stringify({ logs: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
