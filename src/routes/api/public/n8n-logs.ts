import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const messageSchema = z.object({
  type: z.literal("message"),
  external_client_id: z.string().min(1).max(120).optional(),
  client_name: z.string().min(1).max(200).optional(),
  channel: z.enum(["whatsapp", "viber", "sms", "email", "voice"]),
  direction: z.enum(["inbound", "outbound"]).default("outbound"),
  provider: z.string().max(60).optional(),
  provider_message_id: z.string().max(200).optional(),
  subject: z.string().max(300).optional(),
  body: z.string().max(8000).optional(),
  status: z.string().max(40).default("sent"),
  error_message: z.string().max(2000).optional(),
  is_fallback: z.boolean().optional(),
  duration_seconds: z.number().int().min(0).max(86400).optional(),
  recording_url: z.string().url().max(1000).optional(),
  transcript: z.string().max(20000).optional(),
  agent_name: z.string().max(120).optional(),
  occurred_at: z.string().datetime().optional(),
});

const runSchema = z.object({
  type: z.literal("daily_run"),
  run_date: z.string().min(8).max(10),
  total_processed: z.number().int().min(0).default(0),
  total_outstanding: z.number().min(0).default(0),
  whatsapp_queued: z.number().int().min(0).default(0),
  viber_queued: z.number().int().min(0).default(0),
  sms_queued: z.number().int().min(0).default(0),
  email_queued: z.number().int().min(0).default(0),
  voice_queued: z.number().int().min(0).default(0),
  no_contact_count: z.number().int().min(0).default(0),
  no_contact_amount: z.number().min(0).default(0),
  email_only_count: z.number().int().min(0).default(0),
  email_only_amount: z.number().min(0).default(0),
  skipped_cooldown: z.number().int().min(0).default(0),
  summary_text: z.string().max(8000).optional(),
});

const counterSchema = z.object({
  type: z.literal("channel_counter"),
  channel: z.enum(["whatsapp", "viber", "sms", "email", "voice"]),
  date: z.string().min(8).max(10),
  sent_count: z.number().int().min(0),
  daily_limit: z.number().int().min(1).max(100000).default(250),
});

const payloadSchema = z.discriminatedUnion("type", [messageSchema, runSchema, counterSchema]);

function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/n8n-logs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["N8N_WEBHOOK_SECRET"];
        if (!secret) return new Response("Webhook secret not configured", { status: 503 });

        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!timingSafeEqualStr(provided, secret)) {
          return new Response("Invalid webhook secret", { status: 401 });
        }

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        const parsed = payloadSchema.safeParse(json);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid payload", issues: parsed.error.issues.slice(0, 8) },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const payload = parsed.data;

        if (payload.type === "message") {
          const { type: _t, external_client_id, client_name, ...message } = payload;
          let clientId: string | null = null;

          if (external_client_id) {
            const { data } = await supabaseAdmin
              .from("clients")
              .select("id")
              .eq("external_id", external_client_id)
              .maybeSingle();
            clientId = data?.id ?? null;
          }
          if (!clientId && client_name) {
            const { data } = await supabaseAdmin
              .from("clients")
              .select("id")
              .eq("client_name", client_name)
              .maybeSingle();
            clientId = data?.id ?? null;
          }
          if (!clientId) return new Response("Unknown client", { status: 404 });

          const { error } = await supabaseAdmin
            .from("messages")
            .insert(compact({ ...message, client_id: clientId }) as { channel: string });
          if (error) {
            console.error("n8n message insert failed", error.message);
            return new Response("Could not store message", { status: 500 });
          }
          return Response.json({ ok: true, stored: "message" });
        }

        if (payload.type === "daily_run") {
          const { type: _t, ...run } = payload;
          const { error } = await supabaseAdmin
            .from("daily_run_logs")
            .upsert(compact(run) as { run_date: string }, { onConflict: "run_date" });
          if (error) {
            console.error("n8n run upsert failed", error.message);
            return new Response("Could not store run log", { status: 500 });
          }
          return Response.json({ ok: true, stored: "daily_run" });
        }

        const { type: _t, ...counter } = payload;
        const { error } = await supabaseAdmin
          .from("channel_counters")
          .upsert(
            compact({ ...counter, last_updated: new Date().toISOString() }) as {
              channel: string;
            },
            { onConflict: "channel,date" },
          );
        if (error) {
          console.error("n8n counter upsert failed", error.message);
          return new Response("Could not store counter", { status: 500 });
        }
        return Response.json({ ok: true, stored: "channel_counter" });
      },
    },
  },
});
