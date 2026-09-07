import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/gmail-threads-list")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const res = await fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/gmail-threads-list`);
          const body = await res.text();
          console.log(`[gmail-threads-list] status=${res.status}`);
          return new Response(body, {
            status: res.status,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        } catch (err) {
          console.error("[gmail-threads-list] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch email threads" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
