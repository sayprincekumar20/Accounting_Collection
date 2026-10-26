import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows, fetchDataTable, truncationHeaders } from "@/lib/n8n-datatable";

// Direct n8n Data Table REST API call -- replaces the old N8N_WEBHOOK_BASE_URL
// webhook proxy. This is a pure read, so it no longer counts against n8n's
// workflow execution quota. Response shape is unchanged from before, so
// nothing downstream (email.tsx, sms.tsx, whatsapp.tsx, clients.*.tsx, etc.)
// needs to change.

const CLIENTS_DATA_TABLE_ID = "rJpqXxmxhqJnlLrJ";

interface ClientTableRow {
  client_id: string;
  client_name: string;
  parent_name: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  gmail_available: boolean | null;
  whatsapp_available: boolean | null;
  viber_available: boolean | null;
  collection_amount: number | null;
  due_date: string | null;
  status: string | null;
  invoice_numbers: string | null;
  credit_terms: string | null;
  credit_limit: number | null;
  source: string | null;
  overdue_total?: number | null;
  current_total?: number | null;
  promise_suppressed_until?: string | null;
  suppression_reason?: string | null;
  ar_handoff_until?: string | null;
  sales_person?: string | null;
  segment?: string | null;
  ar_owner?: string | null;
}

export const Route = createFileRoute("/api/clients-list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const fresh = new URL(request.url).searchParams.get("fresh") === "1";
          const result = await fetchDataTable<ClientTableRow>(CLIENTS_DATA_TABLE_ID, { fresh });
          const rows = result.rows;

          // Last contact per client, whatever started it (weekly run or /call from Cliq): latest text
          // sent, latest call placed, and that call's result. Matched on the company part of the
          // client_id, so a client whose contact changed (new row) keeps its earlier activity.
          type Act = Record<string, unknown>;
          const [logs, convos, retries] = await Promise.all([
            fetchAllDataTableRows<Act>("a32Z5oGcNi0xzefb").catch(() => [] as Act[]),
            fetchAllDataTableRows<Act>("2WtfkEaHiBSzgItW").catch(() => [] as Act[]),
            fetchAllDataTableRows<Act>("OgCEYfz7eGjS3dPz").catch(() => [] as Act[]),
          ]);
          const str = (v: unknown) => (v == null ? "" : String(v));
          const key = (id: unknown) => str(id).split("___")[0]!.trim().toLowerCase();
          const at = (r: Act) =>
            new Date(str(r["timestamp"]) || str(r["createdAt"])).getTime() || 0;
          const lastText = new Map<string, Act>();
          const lastCall = new Map<string, Act>();
          for (const l of logs) {
            const ev = str(l["event_type"]).toUpperCase();
            const ch = str(l["channel"]).toUpperCase();
            const k = key(l["client_id"]);
            if (!k) continue;
            const target =
              ev === "SEND_SUCCESS" && ch !== "VOICE"
                ? lastText
                : ch === "VOICE" && ev === "CALL_INITIATED"
                  ? lastCall
                  : null;
            if (!target) continue;
            const prev = target.get(k);
            if (!prev || at(l) > at(prev)) target.set(k, l);
          }
          const answeredAfter = (k: string, t: number) =>
            convos.some(
              (c) =>
                key(c["client_id"]) === k &&
                str(c["channel"]).toUpperCase() === "VOICE" &&
                at(c) >= t - 60000,
            );
          const retryOf = (k: string) =>
            retries.filter((r) => key(r["client_id"]) === k).sort((a, b) => at(b) - at(a))[0];
          const sourceLabel = (r?: Act) => {
            const src = str(r?.["trigger_source"]).toUpperCase();
            const who = str(r?.["requested_by"]);
            if (src === "CLIQ_CALL") return "/call" + (who ? " · " + who : "");
            if (src === "RETRY") return "Retry";
            if (src === "MANUAL_RUN") return "Manual run";
            return src ? "Weekly run" : "Weekly run";
          };
          const activityFor = (clientId: string) => {
            const k = key(clientId);
            const tx = lastText.get(k);
            const cl = lastCall.get(k);
            let callResult = "";
            if (cl) {
              const t = at(cl);
              const rt = retryOf(k);
              const rtAt = rt ? new Date(str(rt["updatedAt"])).getTime() || 0 : 0;
              if (answeredAfter(k, t)) callResult = "Answered";
              else if (rt && rtAt >= t - 60000 && str(rt["status"]).toUpperCase() === "PENDING")
                callResult = "Retry pending";
              else if (rt && rtAt >= t - 60000 && str(rt["status"]).toUpperCase() === "EXHAUSTED")
                callResult = "Not reached";
              else if (Date.now() - t < 15 * 60000) callResult = "In progress";
              else callResult = "No answer";
            }
            return {
              last_text_at: tx ? str(tx["timestamp"]) : "",
              last_text_channel: tx ? str(tx["channel"]).toUpperCase() : "",
              last_text_source: tx ? sourceLabel(tx) : "",
              last_call_at: cl ? str(cl["timestamp"]) : "",
              last_call_source: cl ? sourceLabel(cl) : "",
              last_call_result: callResult,
              contacted_via_call_command: [tx, cl].some(
                (r) => str(r?.["trigger_source"]).toUpperCase() === "CLIQ_CALL",
              ),
            };
          };

          // v3 retires stale duplicate rows (e.g. after a CRM contact change) as
          // INACTIVE; hide them so each customer appears once with current data.
          const clients = rows
            .filter((r) => (r.status || "").toUpperCase() !== "INACTIVE")
            .map((r) => ({
              client_id: r.client_id,
              client_name: r.client_name,
              parent_name: r.parent_name,
              contact_person: r.contact_person || "",
              email: r.email || "",
              phone: r.phone || "",
              gmail_available: !!r.gmail_available,
              sms_available: !!r.phone,
              voice_available: !!r.phone,
              whatsapp_available: !!r.whatsapp_available,
              viber_available: !!r.viber_available,
              collection_amount: Number(r.collection_amount || 0),
              due_date: r.due_date || "",
              status: r.status || "",
              invoice_numbers: r.invoice_numbers || "",
              credit_terms: r.credit_terms || "",
              credit_limit: r.credit_limit != null ? Number(r.credit_limit) : null,
              source: r.source || "",
              overdue_total: Number(r.overdue_total || 0),
              current_total: Number(r.current_total || 0),
              promise_suppressed_until: r.promise_suppressed_until || "",
              suppression_reason: r.suppression_reason || "",
              ar_handoff_until: r.ar_handoff_until || "",
              sales_person: r.sales_person || "",
              segment: r.segment || "",
              ar_owner: r.ar_owner || "",
              ...activityFor(r.client_id),
            }));

          return new Response(JSON.stringify({ clients, truncated: result.truncated }), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...truncationHeaders(result),
            },
          });
        } catch (err) {
          console.error("[clients-list] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch clients" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
