import { createFileRoute } from "@tanstack/react-router";
import { callNow } from "@/lib/n8n-actions";

// "Call again" button: one call with Grace to one client right now (no text). n8n re-checks the client.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/call-now")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const b = (await request.json()) as { client_id?: unknown; requested_by?: unknown };
          const clientId = String(b.client_id ?? "")
            .trim()
            .slice(0, 300);
          const who = String(b.requested_by ?? "")
            .trim()
            .slice(0, 80);
          if (!clientId || !who)
            return json({ ok: false, reply: "client_id and requested_by are required" }, 400);
          return json(await callNow(who, clientId));
        } catch (err) {
          console.error("[call-now] error:", err);
          return json(
            { ok: false, reply: err instanceof Error ? err.message : "Failed to start the call" },
            500,
          );
        }
      },
    },
  },
});
