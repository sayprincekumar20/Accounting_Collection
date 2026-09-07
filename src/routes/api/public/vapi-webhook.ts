import { createFileRoute } from "@tanstack/react-router";

type VapiMessage = { role?: string; message?: string };

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function digits(value: string | undefined | null) {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Vapi server-message receiver. Configure the assistant server URL to
 * POST here with header `x-webhook-secret: <N8N_WEBHOOK_SECRET>`.
 * Handles `end-of-call-report` so finished calls land in the Voice inbox instantly.
 */
export const Route = createFileRoute("/api/public/vapi-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["N8N_WEBHOOK_SECRET"];
        if (!secret) return new Response("Webhook secret not configured", { status: 503 });
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!timingSafeEqualStr(provided, secret)) {
          return new Response("Invalid webhook secret", { status: 401 });
        }

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        const msg = payload?.message ?? payload;
        if (msg?.type && msg.type !== "end-of-call-report") {
          return Response.json({ ok: true, ignored: msg.type });
        }

        const call = msg?.call ?? {};
        const number: string = call?.customer?.number ?? msg?.customer?.number ?? "";
        const key = digits(number).slice(-10);
        if (!key) return Response.json({ ok: true, skipped: "no customer number" });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existing } = await supabaseAdmin
          .from("clients")
          .select("id, phone")
          .not("phone", "is", null);

        let clientId = (existing ?? []).find((c) => digits(c.phone).slice(-10) === key)?.id;
        if (!clientId) {
          const { data: created } = await supabaseAdmin
            .from("clients")
            .insert({
              client_name: call?.customer?.name ?? number,
              phone: number,
              source: "vapi",
              voice_available: true,
              status: "unassigned",
            })
            .select("id")
            .maybeSingle();
          clientId = created?.id;
        }
        if (!clientId) return Response.json({ error: "Client could not be resolved" }, { status: 500 });

        const turns: VapiMessage[] = msg?.artifact?.messages ?? [];
        const transcript =
          msg?.artifact?.transcript ??
          msg?.transcript ??
          (turns.length
            ? turns
                .filter((t) => t.role === "bot" || t.role === "user" || t.role === "assistant")
                .map((t) => `${t.role === "user" ? "Client" : "Agent"}: ${t.message ?? ""}`.trim())
                .join("\n")
            : null);

        const endedReason: string | undefined = msg?.endedReason;
        const status = (() => {
          const r = (endedReason ?? "").toLowerCase();
          if (r.includes("no-answer") || r.includes("busy") || r.includes("did-not-answer"))
            return "no_answer";
          if (r.includes("error") || r.includes("failed")) return "failed";
          return "completed";
        })();

        const { error } = await supabaseAdmin.from("messages").upsert(
          {
            client_id: clientId,
            channel: "voice",
            direction: (call?.type ?? "").toLowerCase().includes("inbound") ? "inbound" : "outbound",
            provider: "Vapi",
            provider_message_id: call?.id ?? msg?.call?.id ?? crypto.randomUUID(),
            subject: endedReason ? `Call ended: ${endedReason}` : "AI voice call",
            body: msg?.analysis?.summary ?? msg?.summary ?? transcript ?? "Voice call logged",
            status,
            duration_seconds: msg?.durationSeconds ? Math.round(msg.durationSeconds) : null,
            recording_url: msg?.artifact?.recordingUrl ?? msg?.recordingUrl ?? null,
            transcript,
            agent_name: call?.assistant?.name ?? msg?.assistant?.name ?? "Accounting Assistant",
            assistant_id: call?.assistantId ?? msg?.assistantId ?? null,
            occurred_at: msg?.startedAt ?? call?.startedAt ?? new Date().toISOString(),
          },
          { onConflict: "channel,provider_message_id" },
        );

        if (error) {
          console.error("Vapi webhook store failed", error.message);
          return Response.json({ error: "Could not store call" }, { status: 500 });
        }
        return Response.json({ ok: true, stored: 1 });
      },
    },
  },
});
