import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/env";
import { sendTelerivetMessage } from "@/lib/telerivet-server";
import { replyMediaUrl, validateReplyMediaAttachments } from "@/lib/reply-media";
import { replyHtmlToText } from "@/lib/reply-format";

export const Route = createFileRoute("/api/viber-send")({
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
            ? replyHtmlToText(body.formattedHtml)
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
            await validateReplyMediaAttachments(attachmentIds);
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

          const viberProjectId = "PJ0c188306515689f8";
          const viberRouteId = "PN29eeae699190f39e";
          const sent = await sendTelerivetMessage({
            projectId: viberProjectId,
            toNumber: phone,
            content: message,
            phoneId: viberRouteId,
            mediaUrls: attachmentIds.map((id) => replyMediaUrl(new URL(request.url).origin, id)),
          });

          return new Response(JSON.stringify({ ok: true, result: sent }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[viber-send] error:", err);
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Failed to send Viber message",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
