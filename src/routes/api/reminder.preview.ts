import { createFileRoute } from "@tanstack/react-router";
import { reminderPreview } from "@/lib/reminder-server";

// Reminder composer: the approved template of each channel for one client, which channels can reach the
// client, and the warnings / blocks. Read-only.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/reminder/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("client_id") || "";
        if (!id) return json({ error: "client_id is required" }, 400);
        try {
          const p = await reminderPreview(id);
          return p ? json(p) : json({ error: "Client not found" }, 404);
        } catch (err) {
          console.error("[reminder-preview] error:", err);
          return json({ error: "Could not load the reminder templates" }, 500);
        }
      },
    },
  },
});
