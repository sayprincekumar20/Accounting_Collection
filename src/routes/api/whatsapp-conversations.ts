import { createFileRoute } from "@tanstack/react-router";
import { fetchRecentWhatsAppMessages } from "@/lib/twilio-server";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { getEnv } from "@/lib/env";

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

interface ClientRow {
  client_id: string;
  client_name: string;
  phone: string;
  status?: string | null;
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
          // Only this project's WhatsApp sender. The Twilio account is shared with
          // another project's sender, so never list the whole account.
          const ourNumber = digits(await getEnv("TWILIO_WHATSAPP_NUMBER"));
          const ourAddr = ourNumber ? `whatsapp:+${ourNumber}` : "";

          const [sentByUs, sentToUs] = ourAddr
            ? await Promise.all([
                fetchRecentWhatsAppMessages({ from: ourAddr }),
                fetchRecentWhatsAppMessages({ to: ourAddr }),
              ])
            : [
                await fetchRecentWhatsAppMessages({}),
                [] as Awaited<ReturnType<typeof fetchRecentWhatsAppMessages>>,
              ];
          const seen = new Set<string>();
          const messages = [...sentByUs, ...sentToUs].filter((m) =>
            seen.has(m.sid) ? false : (seen.add(m.sid), true),
          );

          // Badge data is optional: a failure here must not blank the whole inbox.
          const settled = await Promise.allSettled([
            fetchAllDataTableRows<HistoryEntry>("JyGFOqTqI3QXHJbb"),
            fetchAllDataTableRows<HistoryEntry>("ANfkZZDIrDuC4RjK"),
            fetchAllDataTableRows<ClientRow>("rJpqXxmxhqJnlLrJ"),
          ]);
          const [promises, escalations, clients] = settled.map((r) =>
            r.status === "fulfilled" ? r.value : [],
          ) as [HistoryEntry[], HistoryEntry[], ClientRow[]];

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
          // Clients table. Channel is stored upper-case ("WHATSAPP").
          const phonesFor = (rows: HistoryEntry[]) =>
            new Set(
              rows
                .filter((r) => (r.channel || "").toLowerCase() === "whatsapp")
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
                client_name: nameByPhone.get(otherPartyDigits.slice(-10)) || "",
                notified_ar: escalatedPhones.has(otherPartyDigits.slice(-10)),
                promise_recorded: promisedPhones.has(otherPartyDigits.slice(-10)),
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
          const detail = err instanceof Error ? err.message.slice(0, 300) : String(err);
          return new Response(
            JSON.stringify({ error: "Failed to fetch WhatsApp conversations", detail }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
