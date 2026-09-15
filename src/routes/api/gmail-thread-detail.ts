import { createFileRoute } from "@tanstack/react-router";
import { getAccessToken, gmailFetch, getHeader, extractHtmlBody, GMAIL_BUSINESS_EMAIL } from "@/lib/gmail-server";

// Direct Gmail API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
// Full-body fetch, only ever called on-demand when a thread is opened.

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

          const messages = (thread.messages || [])
            .map((m: any) => {
              const headers = m.payload?.headers;
              const fromRaw = getHeader(headers, "From");
              const isOutbound = fromRaw.toLowerCase().includes(GMAIL_BUSINESS_EMAIL.toLowerCase());

              return {
                id: m.id,
                from: fromRaw,
                to: getHeader(headers, "To"),
                date: getHeader(headers, "Date"),
                direction: isOutbound ? "outbound" : "inbound",
                htmlBody: extractHtmlBody(m.payload),
                hasAttachments: !!m.payload?.parts?.some((p: any) => p.filename && p.filename.length > 0),
              };
            })
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

          return new Response(JSON.stringify({ threadId, messages }), {
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
