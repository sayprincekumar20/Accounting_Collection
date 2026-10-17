import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

// Clients whose contact details should be corrected in Zoho, with the reasons.
const CLIENTS = "rJpqXxmxhqJnlLrJ";
const ESCALATIONS = "ANfkZZDIrDuC4RjK";
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const WRONG_PERSON =
  /(wrong (person|recipient|number|contact)|no longer (with|works|connected)|not the right (person|contact)|resigned|left the company|not (our|my) (account|company))/i;

export const Route = createFileRoute("/api/contacts-to-fix")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [clients, esc] = await Promise.all([
            fetchAllDataTableRows<Row>(CLIENTS),
            fetchAllDataTableRows<Row>(ESCALATIONS).catch(() => [] as Row[]),
          ]);
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
              const phone = s(c["phone"]).replace(/\D/g, "");
              const issues: string[] = [];
              if (!email && !phone) issues.push("No phone and no email");
              if (
                email &&
                /(^|[@.])fake|fake\d*@|@example\.|@test\.|noemail|none@|n\/a/.test(email)
              )
                issues.push("Fake / placeholder email");
              if (email.endsWith("@rareglobalfood.com"))
                issues.push("Internal Rare Global email used as the client email");
              if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email))
                issues.push("Email looks invalid");
              if (phone && !/^(63)?9\d{9}$/.test(phone.replace(/^0/, "")))
                issues.push("Phone is not a valid PH mobile number");
              if (!s(c["contact_person"]).trim())
                issues.push("No contact person (no Accounting / Primary contact in CRM)");
              const wrong = wrongBy.get(s(c["client_id"]));
              if (wrong) issues.push("Escalated as wrong / former contact: " + wrong);
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
