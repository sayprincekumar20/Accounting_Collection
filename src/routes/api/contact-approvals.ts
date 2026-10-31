import { createFileRoute } from "@tanstack/react-router";
import { clearDataTableCache, fetchAllDataTableRows } from "@/lib/n8n-datatable";

// Contact Approvals: every active client with unpaid invoices, its contact, amounts, invoices and
// the Accounting team's approval. Texts and calls (via /call or the automation) only go to approved
// clients. Approvals are stored per company (client_id before '___') by n8n 28_Contact_Approval_Update.
const CLIENTS = "rJpqXxmxhqJnlLrJ";
const APPROVALS = "3IvKKI4AwrBlDeOo";
const APPROVAL_WEBHOOK = "https://rareglobalfood.app.n8n.cloud/webhook/contact-approval-update";
const APPROVAL_SECRET = "ap_9d3e71c4b2a85f06e1d7c3b9a4f2e58d";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const companyKey = (id: unknown) => s(id).split("___")[0]!.trim().toLowerCase();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/contact-approvals")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [clients, approvals] = await Promise.all([
            fetchAllDataTableRows<Row>(CLIENTS),
            fetchAllDataTableRows<Row>(APPROVALS).catch(() => [] as Row[]),
          ]);
          const byCompany = new Map(approvals.map((a) => [s(a["company_key"]), a]));
          const items = clients
            .filter(
              (c) =>
                s(c["status"]).toUpperCase() !== "INACTIVE" &&
                Number(c["collection_amount"] || 0) > 0,
            )
            .map((c) => {
              const invoices: {
                branch: string;
                number: string;
                date: string;
                due: string;
                amount: number;
                balance: number;
                status: string;
                po: string;
              }[] = [];
              try {
                for (const b of JSON.parse(s(c["branches_data"]) || "[]")) {
                  let inv: Row[] = [];
                  try {
                    inv = JSON.parse(s(b.invoice_details) || "[]");
                  } catch {
                    inv = [];
                  }
                  for (const i of inv) {
                    invoices.push({
                      branch: s(b.branch_name),
                      number: s(i["invoice_number"]),
                      date: s(i["invoice_date"]),
                      due: s(i["due_date"]),
                      amount: Number(i["amount"] || 0),
                      balance: Number(i["balance"] || 0),
                      status: s(i["status"]).toUpperCase(),
                      po: s(i["po_number"]),
                    });
                  }
                }
              } catch {
                // keep the row even if its invoice details cannot be read
              }
              const a = byCompany.get(companyKey(c["client_id"]));
              return {
                client_id: s(c["client_id"]),
                client_name: s(c["client_name"]),
                parent_name: s(c["parent_name"]),
                segment: s(c["segment"]),
                sales_person: s(c["sales_person"]),
                ar_owner: s(c["ar_owner"]),
                contact_person: s(c["contact_person"]),
                phone: s(c["phone"]),
                email: s(c["email"]),
                overdue: Number(c["overdue_total"] || 0),
                current: Number(c["current_total"] || 0),
                total: Number(c["collection_amount"] || 0),
                due_date: s(c["due_date"]),
                promise_until: s(c["promise_suppressed_until"]),
                ar_handoff_until: s(c["ar_handoff_until"]),
                refreshed_at: s(c["updatedAt"]),
                invoices,
                approved: !!(a && (a["approved"] === true || s(a["approved"]) === "true")),
                approved_by: a ? s(a["approved_by"]) : "",
                approved_at: a ? s(a["approved_at"]) : "",
                approval_note: a ? s(a["note"]) : "",
              };
            })
            .sort(
              (x, y) =>
                Number(x.approved) - Number(y.approved) ||
                y.overdue - x.overdue ||
                y.total - x.total,
            );
          return json({ items });
        } catch (err) {
          console.error("[contact-approvals] GET error:", err);
          return json({ error: "Failed to load", detail: String(err).slice(0, 300) }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const b = (await request.json()) as {
            approved_by?: string;
            items?: {
              client_id?: string;
              client_name?: string;
              approved?: boolean;
              note?: string;
            }[];
          };
          const items = (b.items || []).filter((i) => i && i.client_id).slice(0, 500);
          if (!items.length || !s(b.approved_by).trim())
            return json({ error: "approved_by and at least one client are required" }, 400);
          const res = await fetch(APPROVAL_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-approval-secret": APPROVAL_SECRET },
            body: JSON.stringify({ approved_by: s(b.approved_by).trim(), items }),
          });
          const out = (await res.json().catch(() => ({}))) as { ok?: boolean; saved?: number };
          if (!res.ok || !out.ok) throw new Error(`n8n approval update failed (${res.status})`);
          clearDataTableCache(APPROVALS);
          return json({ ok: true, saved: out.saved ?? items.length });
        } catch (err) {
          console.error("[contact-approvals] POST error:", err);
          return json({ error: "Failed to save", detail: String(err).slice(0, 300) }, 500);
        }
      },
    },
  },
});
