import { createFileRoute } from "@tanstack/react-router";
import { requireSecret } from "@/lib/env";
import { clearDataTableCache } from "@/lib/n8n-datatable";
import { loadApprovalItems } from "@/lib/approvals-data";

// Contact Approvals: every active client with unpaid invoices, its contact, amounts, invoices and
// the Accounting team's approval. Texts and calls (via /call or the automation) only go to approved
// clients. Approvals are stored per company (client_id before '___') by n8n 28_Contact_Approval_Update.
const APPROVALS = "3IvKKI4AwrBlDeOo";
const APPROVAL_WEBHOOK = "https://rareglobalfood.app.n8n.cloud/webhook/contact-approval-update";
const s = (v: unknown) => (v == null ? "" : String(v));
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
          const data = await loadApprovalItems();
          return json(data);
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
            headers: {
              "Content-Type": "application/json",
              "x-approval-secret": await requireSecret("N8N_APPROVAL_SECRET"),
            },
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
