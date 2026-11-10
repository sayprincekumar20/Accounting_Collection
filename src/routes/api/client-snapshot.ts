import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { buildActivity, companyKey, cycleStart, loadActivityTables } from "@/lib/client-activity";

// One client's full context (escalation card, client header): contact, owner, terms, schedule, amounts,
// invoices with counter dates, approval, promise, last text / call, open escalations.
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v) || 0;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/client-snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("client_id") || "";
        if (!id) return json({ error: "client_id is required" }, 400);
        try {
          const [clients, approvals, promises, escalations, tables] = await Promise.all([
            fetchAllDataTableRows<Row>("rJpqXxmxhqJnlLrJ"),
            fetchAllDataTableRows<Row>("3IvKKI4AwrBlDeOo").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("JyGFOqTqI3QXHJbb").catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>("ANfkZZDIrDuC4RjK").catch(() => [] as Row[]),
            loadActivityTables(),
          ]);
          const k = companyKey(id);
          const live = clients.filter((c) => s(c["status"]).toUpperCase() !== "INACTIVE");
          const c =
            live.find((x) => s(x["client_id"]) === id) ??
            live.find((x) => companyKey(x["client_id"]) === k);
          if (!c) return json({ found: false });
          const invoices: {
            branch: string;
            number: string;
            due: string;
            balance: number;
            status: string;
            counter: string;
          }[] = [];
          try {
            for (const b of JSON.parse(s(c["branches_data"]) || "[]") as Row[]) {
              let inv: Row[] = [];
              try {
                inv = JSON.parse(s(b["invoice_details"]) || "[]");
              } catch {
                inv = [];
              }
              for (const i of inv)
                invoices.push({
                  branch: s(b["branch_name"]),
                  number: s(i["invoice_number"]),
                  due: s(i["due_date"]).slice(0, 10),
                  balance: n(i["balance"]),
                  status: s(i["status"]).toUpperCase(),
                  counter: s(i["counter_date"]).slice(0, 10),
                });
            }
          } catch {
            // unreadable invoice data
          }
          const cycle = cycleStart().getTime();
          const approval = approvals.find((a) => s(a["company_key"]).toLowerCase() === k);
          const approvedThisCycle =
            !!approval &&
            (approval["approved"] === true || s(approval["approved"]) === "true") &&
            (new Date(s(approval["approved_at"])).getTime() || 0) >= cycle;
          const latestPromise = promises
            .filter((p) => companyKey(p["client_id"]) === k)
            .sort((a, b) =>
              s(b["timestamp"] || b["createdAt"]).localeCompare(
                s(a["timestamp"] || a["createdAt"]),
              ),
            )[0];
          const openEsc = escalations.filter(
            (e) =>
              companyKey(e["client_id"]) === k &&
              s(e["channel"]).toUpperCase() !== "SYSTEM" &&
              s(e["status"]).toUpperCase() !== "DONE" &&
              s(e["entry_id"]),
          ).length;
          return json({
            found: true,
            client_id: s(c["client_id"]),
            client_name: s(c["client_name"]),
            contact_person: s(c["contact_person"]),
            phone: s(c["phone"]),
            email: s(c["email"]),
            ar_owner: s(c["ar_owner"]),
            credit_terms: s(c["credit_terms"]),
            credit_limit:
              c["credit_limit"] != null && s(c["credit_limit"]) !== ""
                ? n(c["credit_limit"])
                : null,
            collection_schedule: s(c["collection_schedule"]),
            overdue: n(c["overdue_total"]),
            current: n(c["current_total"]),
            total: n(c["collection_amount"]),
            invoices: invoices.sort((a, b) => a.due.localeCompare(b.due)),
            approved_this_cycle: approvedThisCycle,
            promise: latestPromise
              ? {
                  date: s(latestPromise["promise_date"]).slice(0, 10),
                  channel: s(latestPromise["channel"]),
                }
              : null,
            open_escalations: openEsc,
            last_contact: buildActivity(...tables)(s(c["client_id"])),
          });
        } catch (err) {
          console.error("[client-snapshot] error:", err);
          return json({ error: "Failed to load the client" }, 500);
        }
      },
    },
  },
});
