import { createFileRoute } from "@tanstack/react-router";
import { audit } from "@/lib/assistant/registry";

// AI assistant: an error that happened in the browser (caught by the assistant's error screen). Saved in the
// assistant audit log (action client_error) so the exact message and stack can be read afterwards.
const cut = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export const Route = createFileRoute("/api/assistant/client-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const b = (await request.json()) as Record<string, unknown>;
          await audit(
            { userName: "(browser)", sessionId: "", page: cut(b["page"], 200), workingSet: [] },
            "client_error",
            "ui",
            {
              where: cut(b["where"], 40),
              name: cut(b["name"], 80),
              stack: cut(b["stack"], 900),
              component_stack: cut(b["component_stack"], 400),
              agent: cut(b["agent"], 160),
            },
            "ERROR",
            `${cut(b["name"], 60)}: ${cut(b["message"], 400)}`,
          );
        } catch (err) {
          console.error("[assistant-client-error] failed:", err);
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
