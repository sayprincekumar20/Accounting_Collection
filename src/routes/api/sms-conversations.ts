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
// own bookkeeping, written to n8n's promise_history / escalations tables
// only. We fetch those two (same webhooks /api/promise-history and
// /api/escalations already call) and match them onto conversations by
// phone number.
//
// PER-MESSAGE correlation: both n8n subworkflows (Record Payment Promise /
// Log Escalation) stamp an exact `recorded_at` timestamp at the moment
// AR_Reply_Agent made the call — which happens synchronously, within
// seconds of the triggering message. So each promise/escalation entry is
// matched to whichever message in that phone's thread is closest in time,
// within a tolerance window. Outside that window it still counts at the
// CONVERSATION level (stat card, list badge) even if no single message
// can be confidently pinned.

const CORRELATION_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

interface HistoryEntry {
  client_id: string;
  channel: string;
  recorded_at: string;
}

interface ConversationOut {
  client_id: string; // matches page's phoneDigitsFromClientId() expectation — no "parent___" prefix needed, just the phone
  client_name: string;
  notified_ar: boolean;
  promise_recorded: boolean;
  messages: { role: "ai" | "client"; content: string; ts: string; promise_recorded?: boolean; notified_ar?: boolean }[];
  lastMessageAt: string;
  lastMessagePreview: string;
}

function digits(v: string | null | undefined) {
  return (v || "").replace(/\D/g, "");
}

/** Marks the message closest in time to `at`, if within CORRELATION_WINDOW_MS. */
function markNearestMessage(
  messages: ConversationOut["messages"],
  at: string,
  flag: "promise_recorded" | "notified_ar",
) {
  const target = new Date(at).getTime();
  if (Number.isNaN(target) || messages.length === 0) return;

  let closest = messages[0]!;
  let closestDelta = Math.abs(new Date(closest.ts).getTime() - target);
  for (const m of messages) {
    const delta = Math.abs(new Date(m.ts).getTime() - target);
    if (delta < closestDelta) {
      closest = m;
      closestDelta = delta;
    }
  }
  if (closestDelta <= CORRELATION_WINDOW_MS) {
    closest[flag] = true;
  }
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

          const promises: HistoryEntry[] = promisesRes.promises ?? [];
          const escalations: HistoryEntry[] = escalationsRes.escalations ?? [];

          const smsPromisesByPhone = new Map<string, HistoryEntry[]>();
          for (const p of promises) {
            if (p.channel !== "sms") continue;
            const phoneDigits = digits(p.client_id.split("___").pop());
            if (!phoneDigits) continue;
            if (!smsPromisesByPhone.has(phoneDigits)) smsPromisesByPhone.set(phoneDigits, []);
            smsPromisesByPhone.get(phoneDigits)!.push(p);
          }
          const smsEscalationsByPhone = new Map<string, HistoryEntry[]>();
          for (const e of escalations) {
            if (e.channel !== "sms") continue;
            const phoneDigits = digits(e.client_id.split("___").pop());
            if (!phoneDigits) continue;
            if (!smsEscalationsByPhone.has(phoneDigits)) smsEscalationsByPhone.set(phoneDigits, []);
            smsEscalationsByPhone.get(phoneDigits)!.push(e);
          }

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
                notified_ar: smsEscalationsByPhone.has(phoneDigits),
                promise_recorded: smsPromisesByPhone.has(phoneDigits),
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

          // Correlate each promise/escalation entry to its nearest message by timestamp
          for (const [phoneDigits, convo] of byPhone) {
            for (const p of smsPromisesByPhone.get(phoneDigits) || []) {
              markNearestMessage(convo.messages, p.recorded_at, "promise_recorded");
            }
            for (const e of smsEscalationsByPhone.get(phoneDigits) || []) {
              markNearestMessage(convo.messages, e.recorded_at, "notified_ar");
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
