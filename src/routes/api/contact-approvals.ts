import { createFileRoute } from "@tanstack/react-router";
import { clearDataTableCache } from "@/lib/n8n-datatable";
import { loadApprovalItems } from "@/lib/approvals-data";
import { saveApprovals } from "@/lib/approvals-engine";

// Contact Approvals: every active client with unpaid invoices, its contact, amounts, invoices and
// the Accounting team's approval. Texts and calls (via /call or the automation) only go to approved
// clients. Approvals are stored per company (client_id before '___') by n8n 28_Contact_Approval_Update.
const APPROVALS = "3IvKKI4AwrBlDeOo";
const s = (v: unknown) => (v == null ? "" : String(v));
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
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
              allow_multibranch?: boolean;
              /** Invoice numbers unticked at approval: only the ticked ones are sent this cycle. */
              excluded_invoices?: unknown;
            }[];
          };
          const items = (b.items || [])
            .filter((i) => i && i.client_id)
            .slice(0, 500)
            .map((i) => ({
              ...i,
              ...(Array.isArray(i.excluded_invoices)
                ? {
                    excluded_invoices: i.excluded_invoices
                      .map((x) => String(x).slice(0, 80))
                      .slice(0, 500),
                  }
                : {}),
            }));
          if (!items.length || !s(b.approved_by).trim())
            return json({ error: "approved_by and at least one client are required" }, 400);
          const who = s(b.approved_by).trim();
          const { saved, handledBy, warnings } = await saveApprovals(items, who);
          clearDataTableCache(APPROVALS);
          // An invoice selection changes the clients' rows (n8n 28): show them fresh.
          clearDataTableCache("rJpqXxmxhqJnlLrJ");
          return json({ ok: true, saved, ...(warnings.length ? { warnings } : {}) }, 200, {
            "X-Handled-By": handledBy,
          });
        } catch (err) {
          console.error("[contact-approvals] POST error:", err);
          return json({ error: "Failed to save", detail: String(err).slice(0, 300) }, 500);
        }
      },
    },
  },
});
