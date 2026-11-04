import { createFileRoute } from "@tanstack/react-router";

// 'Approve & contact now' (Contact Approvals, 5+ branch section): runs the same /call command as #Sales
// (Zoho refresh -> PDF -> email / Viber / SMS -> Grace's call), with the dashboard user as requester.
// The approval with allow_multibranch must already be saved (POST /api/contact-approvals).
const CALL_COMMAND_WEBHOOK = "https://rareglobalfood.app.n8n.cloud/webhook/cliq-call-command";
const CALL_COMMAND_SECRET = "cc_52fb8bcde4e0672f0dd173b0248f1da488b26f75";
const SALES_CHAT_ID = "CT_1424577087845262897_826674771";
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
          const b = (await request.json()) as { names?: string[]; requested_by?: string };
          const names = (b.names || [])
            .map((n) => String(n || "").trim())
            .filter(Boolean)
            .slice(0, 20);
          const who = String(b.requested_by || "")
            .trim()
            .slice(0, 80);
          if (!names.length || !who)
            return json({ error: "requested_by and at least one client name are required" }, 400);
          const res = await fetch(CALL_COMMAND_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-cliq-secret": CALL_COMMAND_SECRET },
            body: JSON.stringify({
              text: names.join("\n"),
              user_name: who + " (dashboard)",
              user_id: "",
              user_email: "",
              chat_id: SALES_CHAT_ID,
              chat_type: "channel",
              chat_title: "Sales",
              channel_unique_name: "sales",
            }),
          });
          const out = (await res.json().catch(() => ({}))) as { reply?: string };
          if (!res.ok) throw new Error(`call command failed (${res.status})`);
          return json({ ok: true, reply: out.reply || "" });
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
