import { createFileRoute } from "@tanstack/react-router";
import { fetchRecentWhatsAppMessages } from "@/lib/twilio-server";

// Direct Twilio API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
//
// Both directions of a WhatsApp conversation pass through Twilio (inbound
// customer replies AND outbound AI replies are both sent/received via
// Twilio), so the raw message log is enough to reconstruct the thread
// itself.
//
// promise_recorded / notified_ar are matched at the CONVERSATION level by
// phone number / client_id — same identity key used to group the
// conversation in the first place — rather than by nearest-timestamp
// guessing. This is coarser (it won't highlight the exact message that
// triggered a promise) but it's a hard match on identity, not a proximity
// heuristic, so there's no tolerance window to get wrong. Per-message
// flags are intentionally left unset.

interface HistoryEntry {
  client_id: string;
  channel: string;
}

interface ConversationOut {
  client_id: string; // phone digits — matches page's phoneDigitsFromClientId() expectation
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

export const Route = createFileRoute("/api/whatsapp-conversations")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const ourNumber = digits(process.env["TWILIO_WHATSAPP_NUMBER"]);

          const [messages, promisesRes, escalationsRes] = await Promise.all([
            fetchRecentWhatsAppMessages({}),
            fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/promise-history-list`).then((r) => r.json()),
            fetch(`${process.env["N8N_WEBHOOK_BASE_URL"]}/escalations-list`).then((r) => r.json()),
          ]);

          const promises: HistoryEntry[] = promisesRes.promises ?? [];
          const escalations: HistoryEntry[] = escalationsRes.escalations ?? [];

          // Match by phone digits pulled out of client_id ("parent___phone" or bare phone)
          const promisedPhones = new Set(
            promises
              .filter((p) => p.channel === "whatsapp")
              .map((p) => digits(p.client_id.split("___").pop())),
          );
          const escalatedPhones = new Set(
            escalations
              .filter((e) => e.channel === "whatsapp")
              .map((e) => digits(e.client_id.split("___").pop())),
          );

          const byPhone = new Map<string, ConversationOut>();

          // Oldest first within each conversation, so messages render in order
          const sorted = [...messages].sort(
            (a, b) => new Date(a.date_created).getTime() - new Date(b.date_created).getTime(),
          );

          for (const m of sorted) {
            const fromDigits = digits(m.from.replace("whatsapp:", ""));
            const toDigits = digits(m.to.replace("whatsapp:", ""));
            // The "other party" is whichever side isn't our own WhatsApp number
            const otherPartyDigits = fromDigits === ourNumber ? toDigits : fromDigits;
            if (!otherPartyDigits) continue;

            if (!byPhone.has(otherPartyDigits)) {
              byPhone.set(otherPartyDigits, {
                client_id: otherPartyDigits,
                client_name: "",
                notified_ar: escalatedPhones.has(otherPartyDigits),
                promise_recorded: promisedPhones.has(otherPartyDigits),
                messages: [],
                lastMessageAt: "",
                lastMessagePreview: "",
              });
            }

            const convo = byPhone.get(otherPartyDigits)!;
            const ts = m.date_sent || m.date_created;
            convo.messages.push({
              role: fromDigits === ourNumber ? "ai" : "client",
              content: m.body || "",
              ts,
            });
            convo.lastMessageAt = ts;
            convo.lastMessagePreview = (m.body || "").slice(0, 140);
          }

          const conversations = Array.from(byPhone.values()).sort(
            (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
          );

          return new Response(JSON.stringify({ conversations }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[whatsapp-conversations] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch WhatsApp conversations" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
