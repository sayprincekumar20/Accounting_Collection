import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vapi-call-detail")({
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
            `${process.env["N8N_WEBHOOK_BASE_URL"]}/vapi-call-detail?callId=${encodeURIComponent(callId)}`,
          );
          const body = await res.text();
          return new Response(body, {
            status: res.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[vapi-call-detail] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch call detail" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
