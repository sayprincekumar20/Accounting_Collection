import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

// Payment promises per client (latest promise each): due today, upcoming, broken (date passed and
// the client still owes money), or kept (date passed and no balance left / no longer overdue).
const PROMISES = "JyGFOqTqI3QXHJbb";
const CLIENTS = "rJpqXxmxhqJnlLrJ";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const manilaDay = (d: Date) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);

export const Route = createFileRoute("/api/promises-board")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [proms, clients] = await Promise.all([
            fetchAllDataTableRows<Row>(PROMISES),
            fetchAllDataTableRows<Row>(CLIENTS).catch(() => [] as Row[]),
          ]);
          const byId = new Map(clients.map((c) => [s(c["client_id"]), c]));
          const latest = new Map<string, Row>();
          for (const p of proms) {
            const id = s(p["client_id"]);
            const t = new Date(s(p["timestamp"]) || s(p["createdAt"])).getTime() || 0;
            const prev = latest.get(id);
            if (
              !prev ||
              t > (new Date(s(prev["timestamp"]) || s(prev["createdAt"])).getTime() || 0)
            )
              latest.set(id, p);
          }
          const today = manilaDay(new Date());
          const items = [...latest.values()]
            .map((p) => {
              const c = byId.get(s(p["client_id"])) || {};
              const date = s(p["promise_date"]).slice(0, 10);
              const pd = date
                ? manilaDay(
                    new Date(
                      s(p["promise_date"]).length > 10
                        ? s(p["promise_date"])
                        : `${date}T00:00:00+08:00`,
                    ),
                  )
                : "";
              const balance = Number(c["collection_amount"] || 0);
              const active = !!c["client_id"] && s(c["status"]).toUpperCase() !== "INACTIVE";
              let state = "UPCOMING";
              if (!pd) state = "UNKNOWN";
              else if (pd === today) state = "DUE_TODAY";
              else if (pd < today) state = active && balance > 0 ? "BROKEN" : "KEPT";
              return {
                client_id: s(p["client_id"]),
                client_name: s(p["client_name"]) || s(c["client_name"]),
                contact_person: s(c["contact_person"]),
                phone: s(c["phone"]),
                email: s(c["email"]),
                ar_owner: s(c["ar_owner"]),
                channel: s(p["channel"]).toUpperCase(),
                promise_date: pd,
                recorded_at: s(p["timestamp"]) || s(p["createdAt"]),
                reason: s(p["reason"]),
                balance,
                state,
              };
            })
            .sort((a, b) => a.promise_date.localeCompare(b.promise_date));
          return new Response(JSON.stringify({ items, today }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[promises-board] error:", err);
          return new Response(
            JSON.stringify({ error: "Failed to load promises", detail: String(err).slice(0, 300) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
