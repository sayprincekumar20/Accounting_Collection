import { createFileRoute } from "@tanstack/react-router";
import { getAccessToken, gmailFetch, getHeader, parseSender, GMAIL_BUSINESS_EMAIL } from "@/lib/gmail-server";

// Direct Gmail API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
// Matches the real ThreadListItem contract from email.tsx exactly:
//   client_id, client_name, contact_person, thread_id, notified_ar,
//   promise_recorded, message_count, lastMessagePreview, lastDirection,
//   lastMessageAt
//
// Client matching: for each thread, find the participant email that ISN'T
// our own GMAIL_BUSINESS_EMAIL, then match it against /clients-list's
// `email` field (case-insensitive). promise_recorded / notified_ar are
// then matched by that client's client_id — same identity-based approach
// used for SMS/WhatsApp, not timestamp proximity.

const CHUNK_SIZE = 15;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1000];

interface ClientRow {
  client_id: string;
  client_name: string;
  contact_person: string;
  email: string;
}
interface HistoryEntry {
  client_id: string;
  channel: string;
}

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
      return null;
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

          const [accessToken, clientsRes, promisesRes, escalationsRes] = await Promise.all([
            getAccessToken(),
            fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/clients-list`).then((r) => r.json()),
            fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/promise-history-list`).then((r) => r.json()),
            fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/escalations-list`).then((r) => r.json()),
          ]);

          const clients: ClientRow[] = clientsRes.clients ?? [];
          const promises: HistoryEntry[] = promisesRes.promises ?? [];
          const escalations: HistoryEntry[] = escalationsRes.escalations ?? [];

          const promisedClientIds = new Set(
            promises.filter((p) => p.channel === "email").map((p) => p.client_id),
          );
          const escalatedClientIds = new Set(
            escalations.filter((e) => e.channel === "email").map((e) => e.client_id),
          );

          const listParams = new URLSearchParams({ q: "-in:chats -in:draft", maxResults });
          if (pageToken) listParams.set("pageToken", pageToken);

          const list = await gmailFetch<{ threads?: { id: string }[]; nextPageToken?: string }>(
            `/threads?${listParams.toString()}`,
            accessToken,
          );

          const threadIds = (list.threads || []).map((t) => t.id);
          const rawThreads: any[] = [];
          for (let i = 0; i < threadIds.length; i += CHUNK_SIZE) {
            const chunk = threadIds.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(chunk.map((id) => fetchThreadMetadata(id, accessToken)));
            rawThreads.push(...chunkResults.filter(Boolean));
          }

          const threads = rawThreads.map((thread) => {
            const lastMessage = thread.messages[thread.messages.length - 1];
            const headers = lastMessage.payload?.headers;
            const fromRaw = getHeader(headers, "From");
            const toRaw = getHeader(headers, "To");
            const fromParsed = parseSender(fromRaw);
            const toParsed = parseSender(toRaw);
            const isOutbound = fromParsed.email === GMAIL_BUSINESS_EMAIL.toLowerCase();
            const otherPartyEmail = isOutbound ? toParsed.email : fromParsed.email;

            const client = clients.find((c) => (c.email || "").toLowerCase() === otherPartyEmail);

            return {
              client_id: client?.client_id ?? otherPartyEmail,
              client_name: client?.client_name ?? (isOutbound ? toParsed.name : fromParsed.name) ?? otherPartyEmail,
              contact_person: client?.contact_person ?? "",
              thread_id: thread.id,
              notified_ar: client ? escalatedClientIds.has(client.client_id) : false,
              promise_recorded: client ? promisedClientIds.has(client.client_id) : false,
              message_count: thread.messages.length,
              lastMessagePreview: lastMessage.snippet || "",
              lastDirection: isOutbound ? "outbound" : "inbound",
              lastMessageAt: getHeader(headers, "Date"),
            };
          });

          threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

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
