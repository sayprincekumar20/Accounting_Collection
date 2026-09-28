import { createFileRoute } from "@tanstack/react-router";
import { getAccessToken, gmailFetch, getHeader, parseSender, getGmailBusinessEmail } from "@/lib/gmail-server";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

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

          const [accessToken, clientRows, promiseRows, escalationRows] = await Promise.all([
            getAccessToken(),
            fetchAllDataTableRows<{ client_id: string; client_name: string; contact_person: string; email: string }>(
              "rJpqXxmxhqJnlLrJ",
            ),
            fetchAllDataTableRows<{ client_id: string; channel: string }>("JyGFOqTqI3QXHJbb"),
            fetchAllDataTableRows<{ client_id: string; channel: string }>("ANfkZZDIrDuC4RjK"),
          ]);

          const clients: ClientRow[] = clientRows;
          const promises: HistoryEntry[] = promiseRows;
          const escalations: HistoryEntry[] = escalationRows;

          const promisedClientIds = new Set(
            promises.filter((p) => p.channel === "email").map((p) => p.client_id),
          );
          const escalatedClientIds = new Set(
            escalations.filter((e) => e.channel === "email").map((e) => e.client_id),
          );

          const listParams = new URLSearchParams({ maxResults });
          if (pageToken) listParams.set("pageToken", pageToken);

          // This is a real, actively-used personal inbox (tens of thousands of
          // messages), not a dedicated clean business mailbox -- searching
          // "-in:chats -in:draft" with no further scope just returns the most
          // recent threads overall, and any client thread can easily get
          // pushed past the first page by ordinary personal mail arriving in
          // between. Instead, search Gmail directly for known client email
          // addresses, so only genuinely relevant threads are ever considered,
          // regardless of how much unrelated mail exists in between.
          const clientEmails = clients.map((c) => (c.email || "").trim()).filter(Boolean);
          if (clientEmails.length === 0) {
            return new Response(JSON.stringify({ threads: [], nextPageToken: null }), {
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            });
          }
          // Gmail search queries have a practical length limit -- chunk the OR
          // list so this still works as the client roster grows, merging
          // results from each chunk's search.
          const EMAIL_CHUNK_SIZE = 40;
          const emailChunks: string[][] = [];
          for (let i = 0; i < clientEmails.length; i += EMAIL_CHUNK_SIZE) {
            emailChunks.push(clientEmails.slice(i, i + EMAIL_CHUNK_SIZE));
          }

          const seenThreadIds = new Set<string>();
          let nextPageTokenOut: string | null = null;
          for (const chunk of emailChunks) {
            const emailQuery = chunk.map((e) => `from:${e} OR to:${e}`).join(" OR ");
            const chunkParams = new URLSearchParams(listParams);
            chunkParams.set("q", `-in:chats -in:draft (${emailQuery})`);
            const chunkList = await gmailFetch<{ threads?: { id: string }[]; nextPageToken?: string }>(
              `/threads?${chunkParams.toString()}`,
              accessToken,
            );
            for (const t of chunkList.threads || []) seenThreadIds.add(t.id);
            // Only meaningful to report a next page when there's a single
            // email chunk (the common case); with multiple chunks, each has
            // its own independent pagination cursor that doesn't compose
            // cleanly into one token, so pagination is disabled in that case
            // rather than silently dropping threads.
            if (emailChunks.length === 1) nextPageTokenOut = chunkList.nextPageToken || null;
          }
          const threadIds = Array.from(seenThreadIds);
          const rawThreads: any[] = [];
          for (let i = 0; i < threadIds.length; i += CHUNK_SIZE) {
            const chunk = threadIds.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(chunk.map((id) => fetchThreadMetadata(id, accessToken)));
            rawThreads.push(...chunkResults.filter(Boolean));
          }

          const businessEmail = (await getGmailBusinessEmail()).toLowerCase();

          const threads = rawThreads
            .map((thread) => {
              const lastMessage = thread.messages[thread.messages.length - 1];
              const headers = lastMessage.payload?.headers;
              const fromRaw = getHeader(headers, "From");
              const toRaw = getHeader(headers, "To");
              const fromParsed = parseSender(fromRaw);
              const toParsed = parseSender(toRaw);
              const isOutbound = fromParsed.email === businessEmail;
              const otherPartyEmail = isOutbound ? toParsed.email : fromParsed.email;

              const client = clients.find((c) => (c.email || "").toLowerCase() === otherPartyEmail);
              if (!client) return null; // not a known client — drop unrelated inbox mail (newsletters, personal, etc.)

              return {
                client_id: client.client_id,
                client_name: client.client_name,
                contact_person: client.contact_person ?? "",
                thread_id: thread.id,
                notified_ar: escalatedClientIds.has(client.client_id),
                promise_recorded: promisedClientIds.has(client.client_id),
                message_count: thread.messages.length,
                lastMessagePreview: lastMessage.snippet || "",
                lastDirection: isOutbound ? "outbound" : "inbound",
                lastMessageAt: getHeader(headers, "Date"),
              };
            })
            .filter((t): t is NonNullable<typeof t> => t !== null);

          threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

          return new Response(JSON.stringify({ threads, nextPageToken: nextPageTokenOut }), {
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
