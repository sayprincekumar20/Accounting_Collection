import { createFileRoute } from "@tanstack/react-router";

// Sends the approved WhatsApp template 'overdue_invoice_reminder_v3' (with the statement PDF) to one client
// through the existing n8n workflow 06_WhatsApp_Channel_Workflow (webhook /whatsapp-reminder). The workflow
// reads the client row, fills the template variables, checks phone / PDF age, sends via Twilio and logs it.
const N8N_WEBHOOK = "https://rareglobalfood.app.n8n.cloud/webhook/whatsapp-reminder";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/whatsapp-template")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let clientId = "";
        try {
          clientId = String(
            ((await request.json()) as { client_id?: string }).client_id || "",
          ).trim();
        } catch {
          return json({ error: "invalid JSON" }, 400);
        }
        if (!clientId) return json({ error: "client_id is required" }, 400);
        // A bare phone number is not a client_id (the n8n workflow needs the Clients row).
        if (/^\+?\d{8,}$/.test(clientId))
          return json(
            {
              ok: false,
              error:
                "This WhatsApp number is not linked to a client, so the template cannot be filled in.",
            },
            400,
          );
        try {
          const r = await fetch(N8N_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: clientId }),
          });
          const out = (await r.json().catch(() => ({}))) as {
            status?: string;
            message?: string;
            wa_skip_reason?: string;
            sid?: string;
          };
          const ok = r.ok && out.status === "success";
          return json({
            ok,
            note: ok
              ? "Template sent (overdue reminder with statement)."
              : `Not sent: ${out.wa_skip_reason || out.message || "the workflow did not confirm the send"}`,
          });
        } catch (err) {
          console.error("[whatsapp-template] error:", err);
          return json({ ok: false, error: "Could not reach the WhatsApp workflow" }, 502);
        }
      },
    },
  },
});
