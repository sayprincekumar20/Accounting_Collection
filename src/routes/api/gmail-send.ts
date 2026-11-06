import { createFileRoute } from "@tanstack/react-router";
import { sendGmailReply } from "@/lib/gmail-server";

export const Route = createFileRoute("/api/gmail-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            email?: string;
            subject?: string;
            message?: string;
            threadId?: string;
          };
          const email = String(body.email || "").trim();
          const subject = String(body.subject || "(no subject)").trim();
          const message = String(body.message || "").trim();

          if (!email || !message) {
            return new Response(JSON.stringify({ error: "email and message are required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const sent = await sendGmailReply({
            to: email,
            subject,
            body: message,
            ...(body.threadId ? { threadId: body.threadId } : {}),
          });

          return new Response(JSON.stringify({ ok: true, result: sent }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[gmail-send] error:", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send email" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
