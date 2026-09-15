import { createFileRoute } from "@tanstack/react-router";
import { getAccessToken, gmailFetch, getHeader, parseSender, GMAIL_BUSINESS_EMAIL } from "@/lib/gmail-server";

// Direct Gmail API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
// Metadata-only fetch (no full bodies) so this stays cheap on the 60s poll.

const CHUNK_SIZE = 15;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1000];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchThreadMetadata(threadId: string, accessToken: string) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await gmailFetch<any>(
        `/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
        accessToken,
      );
    } catch (err: any) {
      const is429 = String(err.message).includes("(429)");
      if (is429 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 500);
        continue;
      }
      return null; // skip failed thread rather than failing the whole list
    }
  }
  return null;
}

export const Route = createFileRoute("/api/gmail-threads-list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const maxResults = url.searchParams.get("maxResults") || "40";
          const pageToken = url.searchParams.get("pageToken");

          const accessToken = await getAccessToken();

          const listParams = new URLSearchParams({ q: "-in:chats -in:draft", maxResults });
          if (pageToken) listParams.set("pageToken", pageToken);

          const list = await gmailFetch<{ threads?: { id: string }[]; nextPageToken?: string }>(
            `/threads?${listParams.toString()}`,
            accessToken,
          );

          const threadIds = (list.threads || []).map((t) => t.id);
          const results: any[] = [];

          for (let i = 0; i < threadIds.length; i += CHUNK_SIZE) {
            const chunk = threadIds.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(chunk.map((id) => fetchThreadMetadata(id, accessToken)));
            results.push(...chunkResults.filter(Boolean));
          }

          const threads = results.map((thread) => {
            const lastMessage = thread.messages[thread.messages.length - 1];
            const headers = lastMessage.payload?.headers;
            const fromRaw = getHeader(headers, "From");
            const isOutbound = fromRaw.toLowerCase().includes(GMAIL_BUSINESS_EMAIL.toLowerCase());
            const isUnread = thread.messages.some((m: any) => m.labelIds?.includes("UNREAD"));
            const isFlagged = thread.messages.some((m: any) => m.labelIds?.includes("STARRED"));

            return {
              threadId: thread.id,
              subject: getHeader(headers, "Subject") || "(no subject)",
              from: fromRaw,
              to: getHeader(headers, "To"),
              date: getHeader(headers, "Date"),
              snippet: lastMessage.snippet || "",
              messageCount: thread.messages.length,
              unread: isUnread,
              flagged: isFlagged,
              direction: isOutbound ? "outbound" : "inbound",
            };
          });

          threads.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          return new Response(JSON.stringify({ threads, nextPageToken: list.nextPageToken || null }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[gmail-threads-list] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch email threads" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
