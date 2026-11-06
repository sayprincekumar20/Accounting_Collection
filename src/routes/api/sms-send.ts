import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/env";
import { sendTelerivetMessage } from "@/lib/telerivet-server";

export const Route = createFileRoute("/api/sms-send")({
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

          const phoneId = (await getEnv("TELERIVET_SMS_PHONE_ID")) || "";
          if (!phoneId) {
            return new Response(JSON.stringify({ error: "TELERIVET_SMS_PHONE_ID is not configured" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const sent = await sendTelerivetMessage({
            toNumber: phone,
            content: message,
            phoneId,
          });

          return new Response(JSON.stringify({ ok: true, result: sent }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[sms-send] error:", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send SMS" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
