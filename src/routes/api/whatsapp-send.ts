import { createFileRoute } from "@tanstack/react-router";
import { sendTwilioWhatsAppMessage } from "@/lib/twilio-server";
import { replyMediaUrl, validateReplyMediaAttachments } from "@/lib/reply-media";
import { replyHtmlToWhatsAppText } from "@/lib/reply-format";

export const Route = createFileRoute("/api/whatsapp-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            phone?: string;
            message?: string;
            formattedHtml?: string;
            attachments?: string[];
          };
          const phone = String(body.phone || "").trim();
          const message = body.formattedHtml
            ? replyHtmlToWhatsAppText(body.formattedHtml)
            : String(body.message || "").trim();
          if (
            body.attachments !== undefined &&
            (!Array.isArray(body.attachments) ||
              body.attachments.some((id) => typeof id !== "string"))
          ) {
            return new Response(JSON.stringify({ error: "Invalid attachment references" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const attachmentIds = body.attachments || [];

          if (!phone || (!message && !attachmentIds.length)) {
            return new Response(
              JSON.stringify({ error: "phone and message or attachment are required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          try {
            await validateReplyMediaAttachments(attachmentIds, { maxFiles: 1 });
          } catch (validationError) {
            return new Response(
              JSON.stringify({
                error:
                  validationError instanceof Error
                    ? validationError.message
                    : "Invalid attachment references",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const sent = await sendTwilioWhatsAppMessage({
            to: phone,
            body: message,
            mediaUrls: attachmentIds.map((id) => replyMediaUrl(new URL(request.url).origin, id)),
          });

          return new Response(JSON.stringify({ ok: true, result: sent }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[whatsapp-send] error:", err);
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Failed to send WhatsApp message",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
