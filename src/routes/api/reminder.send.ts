import { createFileRoute } from "@tanstack/react-router";
import { sendReminder } from "@/lib/reminder-server";

// Reminder composer: send ONE confirmed reminder. Everything is re-checked on the server (client rules,
// channel rules, warnings acknowledged); WhatsApp always sends the approved template as is.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/reminder/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let b: Record<string, unknown>;
        try {
          b = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
        const requestedBy = str(b["requested_by"], 80).trim();
        if (!requestedBy) return json({ error: "Please give your name (requested_by)." }, 400);
        try {
          const out = await sendReminder(
            {
              clientId: str(b["client_id"], 300),
              channel: str(b["channel"], 20),
              subject: str(b["subject"], 300),
              body: str(b["body"], 6000),
              acknowledged: b["acknowledged"] === true,
            },
            {
              userName: requestedBy,
              sessionId: str(b["session_id"], 80),
              page: "/assistant",
              workingSet: [],
            },
          );
          const code =
            out.status === "sent"
              ? 200
              : out.status === "needs_ack"
                ? 409
                : out.status === "refused"
                  ? 422
                  : 502;
          return json(out, code);
        } catch (err) {
          console.error("[reminder-send] error:", err);
          return json({ status: "failed", message: "The reminder could not be sent." }, 500);
        }
      },
    },
  },
});
