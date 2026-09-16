import { createFileRoute } from "@tanstack/react-router";
import { getAccessToken, gmailFetch, getHeader, extractBody, extractAttachments, getGmailBusinessEmail } from "@/lib/gmail-server";

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
          const accessToken = await getAccessToken();
          const thread = await gmailFetch<any>(`/threads/${threadId}?format=full`, accessToken);

          const threadSubject = getHeader(thread.messages?.[0]?.payload?.headers, "Subject") || "(no subject)";

          const messages = (thread.messages || [])
            .map((m: any) => {
              const headers = m.payload?.headers;
              const fromRaw = getHeader(headers, "From");
              const isOutbound = fromRaw.toLowerCase().includes(getGmailBusinessEmail().toLowerCase());

              return {
                messageId: m.id,
                from: fromRaw,
                to: getHeader(headers, "To"),
                subject: getHeader(headers, "Subject") || threadSubject,
                date: getHeader(headers, "Date"),
                body: extractBody(m.payload),
                attachments: extractAttachments(m.payload).map((a) => ({ ...a, messageId: m.id })),
                direction: isOutbound ? "outbound" : "inbound",
              };
            })
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

          return new Response(JSON.stringify({ threadId, subject: threadSubject, messages }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
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
