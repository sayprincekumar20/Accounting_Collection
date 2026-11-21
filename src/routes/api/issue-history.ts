import { createFileRoute } from "@tanstack/react-router";
import { issueHistory } from "@/lib/issue-server";

// History of one escalation or system notification: AI diagnosis, actions taken, status changes, resolution.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/issue-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") || "";
        if (!id) return json({ error: "id is required" }, 400);
        try {
          return json({ items: await issueHistory(id) });
        } catch (err) {
          console.error("[issue-history] error:", err);
          return json({ error: "Could not load the history" }, 500);
        }
      },
    },
  },
});
