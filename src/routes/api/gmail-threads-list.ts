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
        `/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Date`,
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
          // Up to 100 threads per Gmail page and up to MAX_PAGES pages per email chunk (was a single
          // page of 40, which silently dropped client threads once a chunk had more than 40).
          const maxResults = url.searchParams.get("maxResults") || "100";
          const MAX_PAGES = 3;
          const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 365);
          const sinceMs = Date.now() - days * 86400000;
          const pageToken = url.searchParams.get("pageToken");

          const [accessToken, clientRows, promiseRows, escalationRows, convoRows, logRows] = await Promise.all([
            getAccessToken(),
            fetchAllDataTableRows<{ client_id: string; client_name: string; contact_person: string; email: string }>(
              "rJpqXxmxhqJnlLrJ",
            ),
            fetchAllDataTableRows<{ client_id: string; channel: string }>("JyGFOqTqI3QXHJbb"),
            fetchAllDataTableRows<{ client_id: string; channel: string }>("ANfkZZDIrDuC4RjK"),
            // Every email the automation sends or answers is logged here with its Gmail thread id.
            fetchAllDataTableRows<{
              client_id: string;
              client_name: string;
              channel: string;
              direction: string;
              thread_id: string;
              timestamp: string;
            }>("2WtfkEaHiBSzgItW").catch(() => []),
            // Send attempts (SEND_SUCCESS / failures) per channel.
            fetchAllDataTableRows<{
              client_id: string;
              channel: string;
              event_type: string;
              status: string;
              error_message: string;
              timestamp: string;
            }>("a32Z5oGcNi0xzefb").catch(() => []),
          ]);

          const clients: ClientRow[] = clientRows;
          const promises: HistoryEntry[] = promiseRows;
          const escalations: HistoryEntry[] = escalationRows;

          const promisedClientIds = new Set(
            promises.filter((p) => (p.channel || "").toLowerCase() === "email").map((p) => p.client_id),
          );
          const escalatedClientIds = new Set(
            escalations.filter((e) => (e.channel || "").toLowerCase() === "email").map((e) => e.client_id),
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

          // Automation threads first (newest first): every reminder / AI reply the workflows sent,
          // linked to its client by thread id, whatever address the client later replies from.
          const threadClient = new Map<string, { client_id: string; client_name: string; at: number }>();
          for (const r of convoRows) {
            if (String(r.channel || "").toUpperCase() !== "EMAIL" || !r.thread_id) continue;
            const at = new Date(r.timestamp).getTime() || 0;
            if (at && at < sinceMs) continue;
            const prev = threadClient.get(r.thread_id);
            if (!prev || at > prev.at) threadClient.set(r.thread_id, { client_id: r.client_id, client_name: r.client_name, at });
          }
          const seenThreadIds = new Set<string>(
            [...threadClient.entries()].sort((a, b) => b[1].at - a[1].at).map(([id]) => id),
          );
          const nextPageTokenOut: string | null = null;
          let truncated = false;
          for (const chunk of emailChunks) {
            const emailQuery = chunk.map((e) => `from:${e} OR to:${e}`).join(" OR ");
            let pageCursor: string | undefined;
            for (let page = 0; page < MAX_PAGES; page++) {
              const chunkParams = new URLSearchParams(listParams);
              chunkParams.set("q", `-in:chats -in:draft newer_than:${days}d (${emailQuery})`);
              if (pageCursor) chunkParams.set("pageToken", pageCursor);
              const chunkList = await gmailFetch<{ threads?: { id: string }[]; nextPageToken?: string }>(
                `/threads?${chunkParams.toString()}`,
                accessToken,
              );
              for (const t of chunkList.threads || []) seenThreadIds.add(t.id);
              pageCursor = chunkList.nextPageToken || undefined;
              if (!pageCursor) break;
              if (page === MAX_PAGES - 1) {
                truncated = true;
                console.warn(`[gmail-threads-list] more than ${MAX_PAGES * Number(maxResults)} threads in one email chunk; truncated`);
              }
            }
          }
          // Each thread is one Gmail request; stay well inside Cloudflare's per-request subrequest limit.
          const MAX_THREADS = 350;
          let threadIds = Array.from(seenThreadIds);
          if (threadIds.length > MAX_THREADS) {
            truncated = true;
            threadIds = threadIds.slice(0, MAX_THREADS);
          }
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

              // Match the thread to a client if ANY message involves a client address (From, To or Cc),
              // not only the last message's sender/recipient: clients reply from colleagues' or personal
              // addresses, get copied in Cc, or are one of several recipients.
              const emailsIn = (raw: string) =>
                (String(raw || "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
              const participants = new Set<string>();
              for (const m of thread.messages) {
                for (const h of ["From", "To", "Cc"]) for (const e of emailsIn(getHeader(m.payload?.headers, h))) participants.add(e);
              }
              participants.delete(businessEmail);
              const linked = threadClient.get(thread.id);
              const client =
                (linked && clients.find((c) => c.client_id === linked.client_id)) ||
                (linked ? { client_id: linked.client_id, client_name: linked.client_name, contact_person: "", email: "" } : null) ||
                clients.find((c) => (c.email || "").toLowerCase() === otherPartyEmail) ||
                clients.find((c) => participants.has((c.email || "").toLowerCase().trim()));
              if (!client) return null; // not a known client — drop unrelated inbox mail (newsletters, personal, etc.)

              // Whole-thread view, so the list can say whether the client EVER replied and what
              // they last said, instead of only who sent the newest message.
              type ThreadMsg = typeof lastMessage;
              const msgs: ThreadMsg[] = thread.messages;
              const senderOf = (m: ThreadMsg) => parseSender(getHeader(m.payload?.headers, "From")).email;
              const fromUs = (m: ThreadMsg) => senderOf(m) === businessEmail;
              // Bounces (mailer-daemon/postmaster/no-reply) and our own colleagues are not client replies.
              const isSystem = (m: ThreadMsg) => /(mailer-daemon|postmaster|no-?reply)/i.test(senderOf(m) || "");
              const isInternal = (m: ThreadMsg) => (senderOf(m) || "").endsWith("@rareglobalfood.com");
              const clientMsgs = msgs.filter((m) => !fromUs(m) && !isSystem(m) && !isInternal(m));
              const ourMsgs = msgs.filter((m) => fromUs(m) || isInternal(m));
              const bounced = msgs.some((m) => isSystem(m));
              const lastHuman = [...msgs].reverse().find((m) => !isSystem(m));
              const lastFromHuman = lastHuman && !fromUs(lastHuman) && !isInternal(lastHuman) ? "client" : "us";
              const lastClient = clientMsgs[clientMsgs.length - 1];
              const lastOurs = ourMsgs[ourMsgs.length - 1];

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
                clientReplyCount: clientMsgs.length,
                lastFrom: lastFromHuman,
                bounced,
                lastClientPreview: lastClient?.snippet || "",
                lastClientAt: lastClient ? getHeader(lastClient.payload?.headers, "Date") : "",
                lastOurPreview: lastOurs?.snippet || "",
              };
            })
            .filter((t): t is NonNullable<typeof t> => t !== null);

          // Emails Gmail refused to send (no thread exists): show them too, with the error.
          const failedRows = logRows
            .filter(
              (r) =>
                String(r.channel || "").toUpperCase() === "EMAIL" &&
                (String(r.status || "").toUpperCase() === "FAILED" || /FAIL/i.test(r.event_type || "")) &&
                (new Date(r.timestamp).getTime() || 0) >= sinceMs,
            )
            .map((r) => {
              const c = clients.find((x) => x.client_id === r.client_id);
              return {
                client_id: r.client_id,
                client_name: c?.client_name || r.client_id.split("___")[0] || "",
                contact_person: c?.contact_person ?? "",
                thread_id: "",
                notified_ar: escalatedClientIds.has(r.client_id),
                promise_recorded: promisedClientIds.has(r.client_id),
                message_count: 0,
                lastMessagePreview: r.error_message || "Send failed",
                lastDirection: "outbound",
                lastMessageAt: r.timestamp,
                clientReplyCount: 0,
                lastFrom: "us",
                bounced: false,
                sendFailed: true,
                lastClientPreview: "",
                lastClientAt: "",
                lastOurPreview: "Not sent: " + (r.error_message || "Gmail refused the message"),
              };
            });
          threads.push(...failedRows);
          threads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

          return new Response(JSON.stringify({ threads, nextPageToken: nextPageTokenOut, truncated }), {
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
