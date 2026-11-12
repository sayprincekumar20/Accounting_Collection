import { createFileRoute } from "@tanstack/react-router";
import { loadAssistantHome } from "@/lib/assistant/home";

// AI assistant home screen data: live numbers, today's priorities and the open workflow problems (read-only).
export const Route = createFileRoute("/api/assistant/home")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return new Response(JSON.stringify(await loadAssistantHome()), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[assistant-home] error:", err);
          return new Response(JSON.stringify({ error: "Failed to load" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
