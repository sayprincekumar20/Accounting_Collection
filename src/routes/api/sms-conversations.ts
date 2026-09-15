import { createFileRoute } from "@tanstack/react-router";
import { fetchRecentMessages } from "@/lib/telerivet-server";

// Direct Telerivet API call — replaces the old N8N_WEBHOOK_BASE_URL proxy
// to n8n's internal `conversations` table.
//
// Both directions of an SMS conversation pass through Telerivet (inbound
// customer replies AND outbound AI replies are both sent/received via
// Telerivet), so the raw message log alone is enough to reconstruct the
// conversation thread itself. What Telerivet does NOT know is whether a
// promise-to-pay was recorded or AR was notified — that's AR_Reply_Agent's
// own bookkeeping, stored only in n8n's promise_history / escalations
// tables. We fetch those two (same webhooks the dashboard's own
// /api/promise-history and /api/escalations routes call) and match them
// onto each conversation by phone number, at the CONVERSATION level.
//
// NOTE: per-message notified_ar / promise_recorded flags are NOT
// reconstructed here (left undefined) — that would require knowing which
// exact message in the thread triggered the promise, which only
// AR_Reply_Agent's own reasoning trace knows. The frontend already treats
// these as optional per message, so this degrades gracefully: the
// conversation-level badge and stat count still work correctly, just not
// the individual message-level highlight.

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
          const phoneId = process.env["TELERIVET_SMS_PHONE_ID"]; // optional but recommended
          const [messages, promisesRes, escalationsRes] = await Promise.all([
            fetchRecentMessages(phoneId ? { phoneId } : {}),
            fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/promise-history-list`).then((r) => r.json()),
            fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/escalations-list`).then((r) => r.json()),
          ]);

          const promises: { client_id: string; channel: string }[] = promisesRes.promises ?? [];
          const escalations: { client_id: string; channel: string }[] = escalationsRes.escalations ?? [];

          const hasPromise = (phoneDigits: string) =>
            promises.some((p) => digits(p.client_id.split("___").pop()) === phoneDigits && p.channel === "sms");
          const hasEscalation = (phoneDigits: string) =>
            escalations.some(
              (e) => digits(e.client_id.split("___").pop()) === phoneDigits && e.channel === "sms",
            );

          const byPhone = new Map<string, ConversationOut>();

          // Oldest first within each conversation, so messages render in order
          const sorted = [...messages].sort((a, b) => a.time_created - b.time_created);

          for (const m of sorted) {
            const otherParty = m.direction === "incoming" ? m.from_number : m.to_number;
            const phoneDigits = digits(otherParty);
            if (!phoneDigits) continue;

            if (!byPhone.has(phoneDigits)) {
              byPhone.set(phoneDigits, {
                client_id: phoneDigits,
                client_name: "",
                notified_ar: hasEscalation(phoneDigits),
                promise_recorded: hasPromise(phoneDigits),
                messages: [],
                lastMessageAt: "",
                lastMessagePreview: "",
              });
            }

            const convo = byPhone.get(phoneDigits)!;
            const ts = new Date(m.time_created * 1000).toISOString();
            convo.messages.push({
              role: m.direction === "outgoing" ? "ai" : "client",
              content: m.content || "",
              ts,
            });
            convo.lastMessageAt = ts;
            convo.lastMessagePreview = (m.content || "").slice(0, 140);
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
