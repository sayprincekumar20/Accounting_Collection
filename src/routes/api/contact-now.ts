import { createFileRoute } from "@tanstack/react-router";
import { contactClients } from "@/lib/n8n-actions";

// Contact clients now (dashboard: Contact Approvals, AI assistant): the same process as the former Zoho Cliq
// /call (Zoho refresh -> PDF -> email / Viber / SMS -> Grace's call) with all its checks. Approval must exist.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/contact-now")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const b = (await request.json()) as {
            names?: string[];
            requested_by?: string;
            force?: boolean;
          };
          const names = (b.names || [])
            .map((n) => String(n || "").trim())
            .filter(Boolean)
            .slice(0, 20);
          const who = String(b.requested_by || "")
            .trim()
            .slice(0, 80);
          if (!names.length || !who)
            return json({ error: "requested_by and at least one client name are required" }, 400);
          const out = await contactClients(who, names, !!b.force);
          return json({ ok: true, reply: out.reply });
        } catch (err) {
          console.error("[contact-now] error:", err);
          return json(
            { error: "Failed to start the contact", detail: String(err).slice(0, 300) },
            500,
          );
        }
      },
    },
  },
});
