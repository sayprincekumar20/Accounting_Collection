import { createFileRoute } from "@tanstack/react-router";
import { sendTwilioWhatsAppMessage } from "@/lib/twilio-server";

export const Route = createFileRoute("/api/whatsapp-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { phone?: string; message?: string; clientId?: string };
          const phone = String(body.phone || "").trim();
          const message = String(body.message || "").trim();

          if (!phone || !message) {
            return new Response(JSON.stringify({ error: "phone and message are required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const sent = await sendTwilioWhatsAppMessage({
            to: phone,
            body: message,
          });

          return new Response(JSON.stringify({ ok: true, result: sent }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[whatsapp-send] error:", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send WhatsApp message" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
