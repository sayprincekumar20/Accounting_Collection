import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { bounceIssue, latestBounces } from "@/lib/contact-bounces";
import { classifyContact } from "@/lib/contact-issues";

// Clients whose contact details should be corrected in Zoho: each problem (code, short label, details) and
// whether the client can still be reached by email / phone (lib/contact-issues.ts).
const CLIENTS = "rJpqXxmxhqJnlLrJ";
const ESCALATIONS = "ANfkZZDIrDuC4RjK";
const BOUNCES = "mVW2GYHfpumghEeP"; // written by the n8n workflow 18_Email_Bounce_Watcher
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const WRONG_PERSON =
  /(wrong (person|recipient|number|contact)|no longer (with|works|connected)|not the right (person|contact)|resigned|left the company|not (our|my) (account|company))/i;

export const Route = createFileRoute("/api/contacts-to-fix")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [clients, esc, bounceRows] = await Promise.all([
            fetchAllDataTableRows<Row>(CLIENTS),
            fetchAllDataTableRows<Row>(ESCALATIONS).catch(() => [] as Row[]),
            fetchAllDataTableRows<Row>(BOUNCES).catch(() => [] as Row[]),
          ]);
          const bounces = latestBounces(bounceRows);
          const since = Date.now() - 45 * 86400000;
          const wrongBy = new Map<string, string>();
          for (const e of esc) {
            const t = new Date(s(e["timestamp"]) || s(e["createdAt"])).getTime() || 0;
            if (t >= since && WRONG_PERSON.test(s(e["reason"])))
              wrongBy.set(s(e["client_id"]), s(e["reason"]).slice(0, 160));
          }
          const items = clients
            .filter((c) => s(c["status"]).toUpperCase() !== "INACTIVE")
            .map((c) => {
              const email = s(c["email"]).trim().toLowerCase();
              const { issues, reach } = classifyContact({
                email: s(c["email"]),
                phone: s(c["phone"]),
                contact_person: s(c["contact_person"]),
                bounce: bounceIssue(email, bounces.get(s(c["client_id"]))) || "",
                wrongPerson: wrongBy.get(s(c["client_id"])) || "",
              });
              return {
                client_id: s(c["client_id"]),
                client_name: s(c["client_name"]),
                parent_name: s(c["parent_name"]),
                contact_person: s(c["contact_person"]),
                email: s(c["email"]),
                phone: s(c["phone"]),
                ar_owner: s(c["ar_owner"]),
                sales_person: s(c["sales_person"]),
                balance: Number(c["collection_amount"] || 0),
                issues,
                reach,
              };
            })
            .filter((x) => x.issues.length)
            .sort((a, b) => b.balance - a.balance);
          return new Response(JSON.stringify({ items }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[contacts-to-fix] error:", err);
          return new Response(
            JSON.stringify({ error: "Failed to load", detail: String(err).slice(0, 300) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
