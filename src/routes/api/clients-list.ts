import { createFileRoute } from "@tanstack/react-router";
import { fetchDataTable, truncationHeaders } from "@/lib/n8n-datatable";

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
