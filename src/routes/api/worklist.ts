import { createFileRoute } from "@tanstack/react-router";
import { clearDataTableCache, fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { isNotReachedAlert } from "@/lib/authorship";

// AR worklist: every real escalation (not the automatic "Not reached by phone" alert) with its
// handling status. POST updates status / handled_by / note for one escalation (entry_id).
const ESCALATIONS = "ANfkZZDIrDuC4RjK";
const CLIENTS = "rJpqXxmxhqJnlLrJ";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const STATUSES = ["OPEN", "IN_PROGRESS", "DONE"];
const WORKLIST_WEBHOOK = "https://rareglobalfood.app.n8n.cloud/webhook/worklist-update";
const WORKLIST_SECRET = "wl_7c41e9a2b05d4f63a8e1c92f6d0b7a35";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/worklist")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [esc, clients] = await Promise.all([
            fetchAllDataTableRows<Row>(ESCALATIONS),
            fetchAllDataTableRows<Row>(CLIENTS).catch(() => [] as Row[]),
          ]);
          const byId = new Map(clients.map((c) => [s(c["client_id"]), c]));
          const items = esc
            .filter(
              (e) =>
                s(e["channel"]).toUpperCase() !== "SYSTEM" &&
                !isNotReachedAlert(e["reason"]) &&
                s(e["entry_id"]),
            )
            .map((e) => {
              const c = byId.get(s(e["client_id"])) || {};
              return {
                entry_id: s(e["entry_id"]),
                client_id: s(e["client_id"]),
                client_name: s(e["client_name"]) || s(c["client_name"]),
                contact_person: s(c["contact_person"]),
                email: s(c["email"]),
                phone: s(c["phone"]),
                ar_owner: s(c["ar_owner"]),
                sales_person: s(c["sales_person"]),
                balance: Number(c["collection_amount"] || 0),
                channel: s(e["channel"]).toUpperCase(),
                reason: s(e["reason"]),
                ref: s(e["ref"]),
                recorded_at: s(e["timestamp"]) || s(e["createdAt"]),
                status: STATUSES.includes(s(e["status"]).toUpperCase())
                  ? s(e["status"]).toUpperCase()
                  : "OPEN",
                handled_by: s(e["handled_by"]),
                handled_at: s(e["handled_at"]),
                ar_note: s(e["ar_note"]),
              };
            })
            .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());
          return json({ items });
        } catch (err) {
          console.error("[worklist] GET error:", err);
          return json({ error: "Failed to load worklist", detail: String(err).slice(0, 300) }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const b = (await request.json()) as {
            entry_id?: string;
            status?: string;
            handled_by?: string;
            note?: string;
          };
          const entryId = s(b.entry_id).trim();
          const status = s(b.status).toUpperCase();
          if (!entryId || !STATUSES.includes(status))
            return json({ error: "entry_id and a valid status are required" }, 400);
          // Saved by the n8n workflow 27_Worklist_Update (a data-table update node), so the
          // dashboard's read-only API key never needs write access.
          const res = await fetch(WORKLIST_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-worklist-secret": WORKLIST_SECRET },
            body: JSON.stringify({
              entry_id: entryId,
              status,
              handled_by: s(b.handled_by).trim(),
              note: s(b.note).trim(),
            }),
          });
          const out = (await res.json().catch(() => ({}))) as { ok?: boolean; updated?: number };
          if (!res.ok || !out.ok) throw new Error(`n8n worklist update failed (${res.status})`);
          if (!out.updated)
            return json(
              { error: "This escalation was not found (it may have been archived)." },
              404,
            );
          clearDataTableCache(ESCALATIONS);
          return json({ ok: true });
        } catch (err) {
          console.error("[worklist] POST error:", err);
          return json({ error: "Failed to update", detail: String(err).slice(0, 300) }, 500);
        }
      },
    },
  },
});
