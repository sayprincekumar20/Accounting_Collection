import { createFileRoute } from "@tanstack/react-router";
import { fetchRecentMessages } from "@/lib/telerivet-server";
import { getEnv } from "@/lib/env";

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
}

interface ConversationOut {
  client_id: string; // matches page's phoneDigitsFromClientId() expectation — no "parent___" prefix needed, just the phone
  client_name: string;
  notified_ar: boolean;
  promise_recorded: boolean;
  messages: { role: "ai" | "client"; content: string; ts: string }[];
  lastMessageAt: string;
  lastMessagePreview: string;
}

function digits(v: string | null | undefined) {
  return (v || "").replace(/\D/g, "");
}

export const Route = createFileRoute("/api/sms-conversations")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const phoneId = await getEnv("TELERIVET_SMS_PHONE_ID"); // optional but recommended
          const n8nBase = await getEnv("N8N_WEBHOOK_BASE_URL");

          // Use allSettled, not all: this endpoint combines 4 independent sources
          // (Telerivet + 3 n8n webhooks). A promise/escalation/client lookup failing
          // is a real but secondary problem -- it should degrade to missing badges,
          // not take down the whole SMS tab. Telerivet itself is the one source
          // where a genuine failure means we truly have nothing to show.
          const results = await Promise.allSettled([
            fetchRecentMessages(phoneId ? { phoneId } : {}),
            fetch(`${n8nBase}/promise-history-list`).then((r) => r.json()),
            fetch(`${n8nBase}/escalations-list`).then((r) => r.json()),
            fetch(`${n8nBase}/clients-list`).then((r) => r.json()),
          ]);

          if (results[0].status === "rejected") {
            console.error("[sms-conversations] Telerivet fetch failed:", results[0].reason);
            // TEMPORARY: surfacing the real error message directly in the response
            // body for debugging (no Workers Logs access in this session). Revert
            // once root cause is confirmed and fixed.
            return new Response(
              JSON.stringify({
                error: "Failed to fetch SMS conversations from Telerivet",
                debug_message: results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason),
              }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }
          const messages = results[0].value;

          const logSoft = (label: string, r: PromiseSettledResult<any>) => {
            if (r.status === "rejected") console.error(`[sms-conversations] ${label} fetch failed (non-fatal):`, r.reason);
          };
          logSoft("promise-history", results[1]);
          logSoft("escalations", results[2]);
          logSoft("clients", results[3]);

          const promisesRes = results[1].status === "fulfilled" ? results[1].value : {};
          const escalationsRes = results[2].status === "fulfilled" ? results[2].value : {};
          const clientsRes = results[3].status === "fulfilled" ? results[3].value : {};

          const promises: HistoryEntry[] = promisesRes.promises ?? [];
          const escalations: HistoryEntry[] = escalationsRes.escalations ?? [];
          const clients: ClientRow[] = clientsRes.clients ?? [];

          // Build a phone-digits -> client_name lookup once, same normalization
          // used everywhere else in this file (last-10-digits match, so it's
          // tolerant of country-code prefix differences between Telerivet's
          // numbers and however the Clients table stores phone).
          const nameByPhone = new Map<string, string>();
          for (const c of clients) {
            const d = digits(c.phone).slice(-10);
            if (d) nameByPhone.set(d, c.client_name);
          }

          // Match by phone digits pulled out of client_id ("parent___phone" or bare phone)
          const promisedPhones = new Set(
            promises.filter((p) => p.channel === "sms").map((p) => digits(p.client_id.split("___").pop())),
          );
          const escalatedPhones = new Set(
            escalations.filter((e) => e.channel === "sms").map((e) => digits(e.client_id.split("___").pop())),
          );

          const byPhone = new Map<string, ConversationOut>();

          // Oldest first within each conversation, so messages render in order
          const sorted = [...messages].sort((a, b) => a.time_created - b.time_created);

          for (const m of sorted) {
            try {
              const otherParty = m.direction === "incoming" ? m.from_number : m.to_number;
              const phoneDigits = digits(otherParty);
              if (!phoneDigits) continue;

              if (!byPhone.has(phoneDigits)) {
                byPhone.set(phoneDigits, {
                  client_id: phoneDigits,
                  client_name: nameByPhone.get(phoneDigits.slice(-10)) || "",
                  notified_ar: escalatedPhones.has(phoneDigits),
                  promise_recorded: promisedPhones.has(phoneDigits),
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
              });
              convo.lastMessageAt = ts;
              convo.lastMessagePreview = (m.content || "").slice(0, 140);
            } catch (msgErr) {
              // One malformed message entry should never take down the whole
              // conversation list -- skip it and keep going.
              console.error("[sms-conversations] skipped malformed message:", msgErr, m);
            }
          }

          const conversations = Array.from(byPhone.values()).sort(
            (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
          );

          return new Response(JSON.stringify({ conversations }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[sms-conversations] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch SMS conversations" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
