import { createFileRoute } from "@tanstack/react-router";
import { sendGmailReply } from "@/lib/gmail-server";
import { validateReplyMediaAttachments } from "@/lib/reply-media";
import { replyHtmlToText } from "@/lib/reply-format";
import { parseEmailRecipients } from "@/lib/email-recipients";

export const Route = createFileRoute("/api/gmail-send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            email?: string;
            to?: string;
            cc?: string;
            bcc?: string;
            mode?: "reply" | "replyAll" | "forward";
            subject?: string;
            message?: string;
            threadId?: string;
            formattedHtml?: string;
            attachments?: string[];
          };
          if (body.mode && !["reply", "replyAll", "forward"].includes(body.mode)) {
            return new Response(JSON.stringify({ error: "Invalid email reply mode" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          let to: string[];
          let cc: string[];
          let bcc: string[];
          try {
            to = parseEmailRecipients(String(body.to ?? body.email ?? ""));
            cc = parseEmailRecipients(String(body.cc || ""));
            bcc = parseEmailRecipients(String(body.bcc || ""));
          } catch (recipientError) {
            return new Response(
              JSON.stringify({
                error:
                  recipientError instanceof Error
                    ? recipientError.message
                    : "Invalid email recipient",
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }
          const subject = String(body.subject || "(no subject)").trim();
          const formattedHtml = String(body.formattedHtml || "");
          const message = String(body.message || "").trim() || replyHtmlToText(formattedHtml);
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
          const mode = body.mode || "reply";

          if (mode === "forward" && !body.threadId) {
            return new Response(
              JSON.stringify({ error: "A thread is required to forward a message" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          if (!to.length) {
            return new Response(
              JSON.stringify({ error: "At least one To recipient is required" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          if (!message && !attachmentIds.length && !(mode === "forward" && body.threadId)) {
            return new Response(JSON.stringify({ error: "A message or attachment is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
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

          const sent = await sendGmailReply({
            to,
            cc,
            bcc,
            subject,
            body: message,
            htmlBody: formattedHtml,
            attachmentIds,
            mode,
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
