import { createFileRoute } from "@tanstack/react-router";
import {
  getAccessToken,
  gmailFetch,
  getHeader,
  extractBody,
  extractAttachments,
  getGmailBusinessEmail,
} from "@/lib/gmail-server";
import {
  classifyOutbound,
  clientIdsForThread,
  escalationsFor,
  loadAuthorshipContext,
} from "@/lib/authorship";

// Direct Gmail API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
// Matches the real ThreadDetail / ThreadMessage contract from email.tsx:
//   { threadId, subject, messages: [{ messageId, from, to, subject, date,
//     body, attachments, direction }] }

export const Route = createFileRoute("/api/gmail-thread-detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const threadId = url.searchParams.get("threadId");
        if (!threadId) {
          return new Response(JSON.stringify({ error: "threadId is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const [accessToken, ctx] = await Promise.all([getAccessToken(), loadAuthorshipContext()]);
          const thread = await gmailFetch<any>(`/threads/${threadId}?format=full`, accessToken);
          const clientIds = clientIdsForThread(ctx, threadId);

          const threadSubject =
            getHeader(thread.messages?.[0]?.payload?.headers, "Subject") || "(no subject)";
          const businessEmail = (await getGmailBusinessEmail()).toLowerCase();

          const messages = (thread.messages || [])
            .map((m: any) => {
              const headers = m.payload?.headers;
              const fromRaw = getHeader(headers, "From");
              const isOutbound = fromRaw.toLowerCase().includes(businessEmail);

              return {
                messageId: m.id,
                from: fromRaw,
                to: getHeader(headers, "To"),
                subject: getHeader(headers, "Subject") || threadSubject,
                date: getHeader(headers, "Date"),
                ...extractBody(m.payload),
                attachments: extractAttachments(m.payload).map((a) => ({ ...a, messageId: m.id })),
                direction: isOutbound ? "outbound" : "inbound",
              };
            })
            .map(
              <T extends { from?: string; direction?: string; date?: string; body?: string }>(
                m: T,
              ) => {
                // Who wrote it: the automated reminder, the AI agent, a person in AR, the client, or a bounce.
                const sender = String(m.from || "").toLowerCase();
                let author: string;
                if (/(mailer-daemon|postmaster|no-?reply)/.test(sender)) author = "system";
                else if (m.direction === "outbound" || sender.includes("@rareglobalfood.com"))
                  author = classifyOutbound(ctx, {
                    clientIds,
                    channel: "EMAIL",
                    messageId: (m as { messageId?: string }).messageId,
                    at: new Date(m.date || "").getTime() || 0,
                    text: String(m.body || "").slice(0, 400),
                    threadId,
                  });
                else author = "client";
                return { ...m, author };
              },
            )
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

          // The AI agents' "notified AR team" events for this client's email conversation.
          const escalations = escalationsFor(ctx, clientIds, "EMAIL");
          return new Response(
            JSON.stringify({ threadId, subject: threadSubject, messages, escalations }),
            {
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        } catch (err) {
          console.error("[gmail-thread-detail] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch thread detail" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
