import { createFileRoute } from "@tanstack/react-router";
import { fetchRecentMessages } from "@/lib/telerivet-server";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import {
  classifyOutbound,
  escalationsFor,
  loadAuthorshipContext,
  type EscalationNote,
} from "@/lib/authorship";

// Direct Telerivet API call — replaces the old N8N_WEBHOOK_BASE_URL proxy
// to n8n's internal `conversations` table.
//
// Both directions of an SMS conversation pass through Telerivet (inbound
// customer replies AND outbound AI replies are both sent/received via
// Telerivet), so the raw message log alone is enough to reconstruct the
// conversation thread itself. What Telerivet does NOT know is whether a
// promise-to-pay was recorded or AR was notified — that's AR_Reply_Agent's
// own bookkeeping, written to n8n's promise_history / escalations tables
// only. We fetch those two (same webhooks /api/promise-history and
// /api/escalations already call) and match them onto conversations by
// phone number / client_id — the same identity key used to group the
// conversation in the first place. This is a hard identity match, not a
// timestamp-proximity guess, so there's no tolerance window to tune or
// get wrong. Per-message flags are intentionally left unset — only the
// conversation-level badge and stat count are populated.

interface HistoryEntry {
  client_id: string;
  channel: string;
}

interface ClientRow {
  client_id: string;
  client_name: string;
  phone: string;
  status?: string | null;
}

interface ConversationOut {
  client_id: string; // matches page's phoneDigitsFromClientId() expectation — no "parent___" prefix needed, just the phone
  client_name: string;
  notified_ar: boolean;
  promise_recorded: boolean;
  messages: {
    role: "ai" | "client";
    content: string;
    ts: string;
    author?: string;
    media?: { url: string; type: string; filename: string }[];
  }[];
  escalations?: EscalationNote[];
  lastMessageAt: string;
  lastMessagePreview: string;
}

function digits(v: string | null | undefined) {
  return (v || "").replace(/\D/g, "");
}

export const Route = createFileRoute("/api/viber-conversations")({
  server: {
    handlers: {
      GET: async () => {
        try {
          // Viber reminders go out through the Main Sales project's Viber route ("Rare Global Food",
          // Telesign). Only that route is read, so the sales team's SMS never appear here.
          const VIBER_PROJECT_ID = "PJ0c188306515689f8";
          const VIBER_ROUTE_ID = "PN29eeae699190f39e";

          // Use allSettled, not all: this endpoint combines 4 independent sources
          // (Telerivet + 3 n8n Data Table reads). A promise/escalation/client
          // lookup failing is a real but secondary problem -- it should degrade
          // to missing badges, not take down the whole SMS tab. Telerivet itself
          // is the one source where a genuine failure means we truly have
          // nothing to show. The 3 Data Table reads are direct REST calls (not
          // webhook-triggered workflow executions), so they don't consume n8n's
          // execution quota the way the old webhook proxies did.
          const results = await Promise.allSettled([
            fetchRecentMessages({ projectId: VIBER_PROJECT_ID, phoneId: VIBER_ROUTE_ID }),
            fetchAllDataTableRows<HistoryEntry>("JyGFOqTqI3QXHJbb"),
            fetchAllDataTableRows<HistoryEntry>("ANfkZZDIrDuC4RjK"),
            fetchAllDataTableRows<ClientRow>("rJpqXxmxhqJnlLrJ"),
          ]);

          if (results[0].status === "rejected") {
            console.error("[viber-conversations] Telerivet fetch failed:", results[0].reason);
            return new Response(
              JSON.stringify({ error: "Failed to fetch SMS conversations from Telerivet" }),
              {
                status: 502,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          const messages = results[0].value;

          const logSoft = (label: string, r: PromiseSettledResult<unknown>) => {
            if (r.status === "rejected")
              console.error(`[viber-conversations] ${label} fetch failed (non-fatal):`, r.reason);
          };
          logSoft("promise-history", results[1]);
          logSoft("escalations", results[2]);
          logSoft("clients", results[3]);

          const promises: HistoryEntry[] =
            results[1].status === "fulfilled" ? results[1].value : [];
          const escalations: HistoryEntry[] =
            results[2].status === "fulfilled" ? results[2].value : [];
          const clients: ClientRow[] = results[3].status === "fulfilled" ? results[3].value : [];

          // Build a phone-digits -> client_name lookup once, same normalization
          // used everywhere else in this file (last-10-digits match, so it's
          // tolerant of country-code prefix differences between Telerivet's
          // numbers and however the Clients table stores phone).
          const nameByPhone = new Map<string, string>();
          const phoneByClientId = new Map<string, string>();
          for (const c of clients) {
            const d = digits(c.phone).slice(-10);
            if (!d) continue;
            if ((c.status || "").toUpperCase() !== "INACTIVE" || !nameByPhone.has(d))
              nameByPhone.set(d, c.client_name);
            phoneByClientId.set(c.client_id, d);
          }

          // client_id is "PARENT___email" (or phone); resolve to the client's phone via the
          // Clients table. Channel is stored upper-case ("SMS").
          const phonesFor = (rows: HistoryEntry[]) =>
            new Set(
              rows
                .filter((r) => (r.channel || "").toLowerCase() === "viber")
                .map(
                  (r) =>
                    phoneByClientId.get(r.client_id) ||
                    digits(r.client_id.split("___").pop()).slice(-10),
                )
                .filter(Boolean),
            );
          const promisedPhones = phonesFor(promises);
          const escalatedPhones = phonesFor(escalations);

          const byPhone = new Map<string, ConversationOut>();

          // Oldest first within each conversation, so messages render in order
          const sorted = [...messages].sort((a, b) => a.time_created - b.time_created);

          for (const m of sorted) {
            try {
              const otherParty = m.direction === "incoming" ? m.from_number : m.to_number;
              const phoneDigits = digits(otherParty);
              if (!phoneDigits) continue;
              // Collections inbox: only conversations with numbers in the Clients table
              // (skips test numbers and the gateway's own number). If the Clients read
              // failed, show everything rather than an empty inbox.
              if (nameByPhone.size > 0 && !nameByPhone.has(phoneDigits.slice(-10))) continue;

              if (!byPhone.has(phoneDigits)) {
                byPhone.set(phoneDigits, {
                  client_id: phoneDigits,
                  client_name: nameByPhone.get(phoneDigits.slice(-10)) || "",
                  notified_ar: escalatedPhones.has(phoneDigits.slice(-10)),
                  promise_recorded: promisedPhones.has(phoneDigits.slice(-10)),
                  messages: [],
                  lastMessageAt: "",
                  lastMessagePreview: "",
                });
              }

              const convo = byPhone.get(phoneDigits)!;
              const ts = new Date((m.time_created || 0) * 1000).toISOString();
              convo.messages.push({
                role: m.direction === "outgoing" ? "ai" : "client",
                content: m.content || "",
                ts,
                media: (m.media || [])
                  .filter((x) => x && x.url)
                  .map((x) => ({
                    url: x.url,
                    type: x.type || "",
                    filename: x.filename || "attachment",
                  })),
              });
              convo.lastMessageAt = ts;
              convo.lastMessagePreview = (
                m.content ||
                ((m.media || []).length
                  ? "📎 " + ((m.media || [])[0]?.filename || "Attachment")
                  : "")
              ).slice(0, 140);
            } catch (msgErr) {
              // One malformed message entry should never take down the whole
              // conversation list -- skip it and keep going.
              console.error("[viber-conversations] skipped malformed message:", msgErr, m);
            }
          }

          // Who wrote each message we sent (automated reminder / AI agent / AR team), and the AI
          // agents' "notified AR team" events for each client, shown inline in the conversation.
          const authorCtx = await loadAuthorshipContext().catch(() => null);
          if (authorCtx) {
            const idsByPhone = new Map<string, string[]>();
            for (const c of clients) {
              const d = digits(c.phone).slice(-10);
              if (!d) continue;
              idsByPhone.set(d, [...(idsByPhone.get(d) || []), c.client_id]);
            }
            for (const convo of byPhone.values()) {
              const ids = idsByPhone.get(String(convo.client_id).slice(-10)) || [];
              for (const msg of convo.messages) {
                msg.author =
                  msg.role === "client"
                    ? "client"
                    : classifyOutbound(authorCtx, {
                        clientIds: ids,
                        channel: "VIBER",
                        at: new Date(msg.ts).getTime() || 0,
                        text: msg.content,
                      });
              }
              convo.escalations = escalationsFor(authorCtx, ids, "VIBER");
            }
          }

          const conversations = Array.from(byPhone.values()).sort(
            (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
          );

          return new Response(JSON.stringify({ conversations }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[viber-conversations] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch SMS conversations" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
