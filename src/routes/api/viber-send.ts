import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/env";
import { sendTelerivetMessage } from "@/lib/telerivet-server";

export const Route = createFileRoute("/api/viber-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { phone?: string; message?: string };
          const phone = String(body.phone || "").trim();
          const message = String(body.message || "").trim();

          if (!phone || !message) {
            return new Response(JSON.stringify({ error: "phone and message are required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const viberProjectId = "PJ0c188306515689f8";
          const viberRouteId = "PN29eeae699190f39e";
          const sent = await sendTelerivetMessage({
            projectId: viberProjectId,
            toNumber: phone,
            content: message,
            phoneId: viberRouteId,
          });

          return new Response(JSON.stringify({ ok: true, result: sent }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[viber-send] error:", err);
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : "Failed to send Viber message" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
