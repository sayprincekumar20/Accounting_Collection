import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { isSystemRow } from "@/lib/escalation-alerts";

// System notifications that used to be posted to Zoho Cliq #sales (error alerts, /call run results,
// Friday close-out, client callbacks, ...): saved by the n8n 'Log Escalation' workflow in the
// escalations table that are system notifications (isSystemRow: workflow failures, run results, alerts).
type Row = Record<string, unknown>;
const ESCALATIONS = "ANfkZZDIrDuC4RjK";
const s = (v: unknown) => (v == null ? "" : String(v));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export function kindOf(r: Row): string {
  const id = s(r["client_id"]).toLowerCase();
  const ch = s(r["channel"]).toUpperCase();
  if (ch === "VOICE_CALLBACK") return "Callback";
  if (id.includes("manual-run")) return "/call result";
  if (id.includes("cycle-close-out")) return "Cycle close-out";
  if (/error|failed|crash/i.test(s(r["reason"]) + " " + s(r["message"]))) return "Error";
  return "System";
}

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const rows = await fetchAllDataTableRows<Row>(ESCALATIONS);
          const items = rows
            // Only system rows; client callback requests are customer escalations (Escalations page).
            .filter((r) => isSystemRow(r))
            .map((r) => ({
              id: s(r["entry_id"]) || s(r["id"]),
              at: s(r["timestamp"]) || s(r["createdAt"]),
              kind: kindOf(r),
              title: s(r["client_name"]) || "System",
              summary: s(r["reason"]),
              message: s(r["message"]) || s(r["reason"]),
            }))
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 300);
          return json({ items });
        } catch (err) {
          console.error("[notifications] error:", err);
          return json({ error: "Failed to load notifications" }, 500);
        }
      },
    },
  },
});
