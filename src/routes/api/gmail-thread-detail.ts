import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/gmail-thread-detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          return new Response(JSON.stringify({ error: "threadId is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const res = await fetch(
            `${process.env["N8N_WEBHOOK_BASE_URL"]}/gmail-thread-detail?threadId=${encodeURIComponent(threadId)}`,
          );
          const body = await res.text();
          console.log(`[gmail-thread-detail] threadId=${threadId} status=${res.status}`);
          return new Response(body, {
            status: res.status,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        } catch (err) {
          console.error("[gmail-thread-detail] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch thread detail" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
