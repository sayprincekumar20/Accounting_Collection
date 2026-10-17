import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { isNotReachedAlert } from "@/lib/authorship";

// One client's full history, newest first: reminders sent, calls placed, messages in and out,
// payment promises and AR escalations (with the Cliq Ref).
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const ts = (r: Row) => s(r["timestamp"]) || s(r["createdAt"]);

export const Route = createFileRoute("/api/client-timeline")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const id = new URL(request.url).searchParams.get("client_id") || "";
          if (!id)
            return new Response(JSON.stringify({ events: [] }), {
              headers: { "Content-Type": "application/json" },
            });
          const [logs, convos, proms, esc] = await Promise.all([
            fetchAllDataTableRows<Row>("a32Z5oGcNi0xzefb").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("2WtfkEaHiBSzgItW").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("JyGFOqTqI3QXHJbb").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("ANfkZZDIrDuC4RjK").catch(() => [] as Row[]),
          ]);
          const mine = (r: Row) => s(r["client_id"]) === id;
          const events: {
            at: string;
            kind: string;
            channel: string;
            title: string;
            detail: string;
            ref?: string;
            source?: string;
          }[] = [];
          for (const l of logs.filter(mine)) {
            const ev = s(l["event_type"]).toUpperCase();
            const ch = s(l["channel"]).toUpperCase();
            const title =
              ev === "SEND_SUCCESS"
                ? `Reminder sent (${ch})`
                : ev === "CALL_INITIATED"
                  ? "Call placed"
                  : ev === "CALL_FAILED"
                    ? "Call failed"
                    : ev.includes("FAIL")
                      ? `Send failed (${ch})`
                      : `${ev || "Event"} (${ch})`;
            events.push({
              at: ts(l),
              kind: ev.includes("FAIL") ? "failure" : ch === "VOICE" ? "call" : "reminder",
              channel: ch,
              title,
              detail: s(l["error_message"]),
              source: s(l["trigger_source"]),
            });
          }
          for (const c of convos.filter(mine)) {
            const dir = s(c["direction"]).toUpperCase();
            const ch = s(c["channel"]).toUpperCase();
            const text = s(c["message_text"]);
            if (dir === "OUTBOUND" && /^overdue balance reminder/i.test(text)) continue; // already shown as "Reminder sent"
            events.push({
              at: ts(c),
              kind: dir === "INBOUND" ? "client" : ch === "VOICE" ? "call" : "ai",
              channel: ch,
              title:
                dir === "INBOUND"
                  ? `Client wrote (${ch})`
                  : ch === "VOICE"
                    ? "Call transcript"
                    : `AI agent replied (${ch})`,
              detail: text.slice(0, 600),
            });
          }
          for (const p of proms.filter(mine))
            events.push({
              at: ts(p),
              kind: "promise",
              channel: s(p["channel"]).toUpperCase(),
              title: `Promise to pay on ${s(p["promise_date"]).slice(0, 10)}`,
              detail: s(p["reason"]),
            });
          for (const e of esc.filter(mine)) {
            const notReached = isNotReachedAlert(e["reason"]);
            events.push({
              at: ts(e),
              kind: notReached ? "failure" : "escalation",
              channel: s(e["channel"]).toUpperCase(),
              title: notReached
                ? "Not reached by phone"
                : `Escalated to AR${s(e["status"]) ? " · " + s(e["status"]).replace("_", " ") : ""}`,
              detail: s(e["reason"]) + (s(e["ar_note"]) ? `\nAR note: ${s(e["ar_note"])}` : ""),
              ref: s(e["ref"]),
            });
          }
          events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
          return new Response(JSON.stringify({ events: events.slice(0, 300) }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[client-timeline] error:", err);
          return new Response(
            JSON.stringify({ error: "Failed to load", detail: String(err).slice(0, 300) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
