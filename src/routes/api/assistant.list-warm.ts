import { createFileRoute } from "@tanstack/react-router";
import { loadMatchClients } from "@/lib/assistant/list-server";

// AI assistant: called as soon as a file is attached. Loads the client data into the server's cache while the
// person chooses what to do and which sheet, so the analysis that follows does not wait for n8n.
// Read-only; returns how long the load took.
export const Route = createFileRoute("/api/assistant/list-warm")({
  server: {
    handlers: {
      POST: async () => {
        const t = Date.now();
        try {
          const { clients } = await loadMatchClients();
          const ms = Date.now() - t;
          console.log(`[assistant-list-warm] ${clients.length} clients ready in ${ms} ms`);
          return new Response(JSON.stringify({ ok: true, ms }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[assistant-list-warm] error:", err);
          return new Response(JSON.stringify({ ok: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
