import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

// AR reports built after each /call run (n8n 25_Call_Run_Report), newest first.
const CALL_REPORTS_TABLE_ID = "bqDZYdPyb3JaFAsM";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export const Route = createFileRoute("/api/call-reports")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const rows = await fetchAllDataTableRows<Row>(CALL_REPORTS_TABLE_ID);
          const reports = rows
            .map((r) => {
              const sheetId = s(r["sheet_id"]);
              return {
                id: sheetId,
                as_of: s(r["as_of"]),
                created_at: s(r["created_at"]) || s(r["createdAt"]),
                requested_by: s(r["requested_by"]),
                source: s(r["source"]),
                client_count: Number(r["client_count"] || 0),
                invoice_count: Number(r["invoice_count"] || 0),
                total: Number(r["total"] || 0),
                overdue: Number(r["overdue"] || 0),
                current: Number(r["current"] || 0),
                sheet_url:
                  s(r["sheet_url"]) ||
                  (sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : ""),
                xlsx_url: sheetId
                  ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`
                  : "",
              };
            })
            .filter((r) => r.id)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          return new Response(JSON.stringify({ reports }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[call-reports] fetch error:", err);
          return new Response(
            JSON.stringify({ error: "Failed to load reports", detail: String(err).slice(0, 300) }),
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
