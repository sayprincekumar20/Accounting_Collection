import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Live conversation ingest for the n8n "conversations" data table
 * (table id 2WtfkEaHiBSzgItW). n8n POSTs one turn (or a batch) the moment a
 * message is sent or received on any channel:
 *   SMS / Viber -> Telerivet, WhatsApp -> Twilio, Email -> Gmail, Voice -> ElevenLabs / Vapi
 */
const turnSchema = z.object({
  turn_id: z.string().min(1).max(200),
  client_id: z.string().max(200).optional().nullable(),
  client_name: z.string().max(200).optional().nullable(),
  channel: z.string().min(1).max(40),
  direction: z.string().max(20).optional().nullable(),
  message_text: z.string().max(20000).optional().nullable(),
  notified_ar: z.boolean().optional(),
  promise_recorded: z.boolean().optional(),
  has_attachment: z.boolean().optional(),
  timestamp: z.string().max(60).optional().nullable(),
  // optional extras
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  subject: z.string().max(300).optional().nullable(),
  status: z.string().max(40).optional().nullable(),
  provider: z.string().max(60).optional().nullable(),
  duration_seconds: z.number().int().min(0).max(86400).optional().nullable(),
  recording_url: z.string().max(1000).optional().nullable(),
  transcript: z.string().max(20000).optional().nullable(),
  agent_name: z.string().max(120).optional().nullable(),
});

const bodySchema = z.union([turnSchema, z.array(turnSchema).min(1).max(500)]);

const CHANNELS = ["whatsapp", "viber", "sms", "email", "voice"] as const;
type Channel = (typeof CHANNELS)[number];

const PROVIDER: Record<Channel, string> = {
  whatsapp: "Twilio",
  viber: "Telerivet",
  sms: "Telerivet",
  email: "Gmail",
  voice: "ElevenLabs / Vapi",
};

function normChannel(value: string): Channel {
  const v = value.toLowerCase();
  if (v.includes("whats")) return "whatsapp";
  if (v.includes("viber")) return "viber";
  if (v.includes("mail")) return "email";
  if (v.includes("voice") || v.includes("call")) return "voice";
  return "sms";
}

function normDirection(value: string | null | undefined) {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("in") || v === "received" || v === "client" || v === "customer") return "inbound";
  return "outbound";
}

function toIso(value: string | null | undefined) {
  if (!value) return new Date().toISOString();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== "") {
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    return new Date(ms).toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/n8n-conversation")({
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

        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid payload", issues: parsed.error.issues.slice(0, 8) },
            { status: 400 },
          );
        }
        const turns = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, external_id, client_name, phone, email");

        const byId = new Map<string, string>();
        const byExternal = new Map<string, string>();
        const byName = new Map<string, string>();
        const byPhone = new Map<string, string>();
        const byEmail = new Map<string, string>();
        for (const c of clients ?? []) {
          byId.set(c.id, c.id);
          if (c.external_id) byExternal.set(c.external_id.toLowerCase(), c.id);
          byName.set(c.client_name.toLowerCase(), c.id);
          const p = digits(c.phone);
          if (p) byPhone.set(p, c.id);
          if (c.email) byEmail.set(c.email.toLowerCase(), c.id);
        }

        const rows: Record<string, unknown>[] = [];
        let created = 0;

        for (const t of turns) {
          const channel = normChannel(t.channel);
          const key = t.client_id?.trim() ?? "";
          let clientId =
            (UUID.test(key) ? byId.get(key) : undefined) ??
            (key ? byExternal.get(key.toLowerCase()) : undefined) ??
            (t.client_name ? byName.get(t.client_name.toLowerCase()) : undefined) ??
            (digits(t.phone) ? byPhone.get(digits(t.phone)) : undefined) ??
            (t.email ? byEmail.get(t.email.toLowerCase()) : undefined);

          if (!clientId) {
            const name = t.client_name ?? t.phone ?? t.email ?? (key || "Unknown contact");
            const { data: newClient } = await supabaseAdmin
              .from("clients")
              .insert({
                client_name: name,
                external_id: key || null,
                phone: t.phone ?? null,
                email: t.email ?? null,
                source: "n8n",
                status: "unassigned",
                whatsapp_available: channel === "whatsapp",
                viber_available: channel === "viber",
                sms_available: channel === "sms",
                gmail_available: channel === "email",
                voice_available: channel === "voice",
              })
              .select("id")
              .maybeSingle();
            if (!newClient?.id) continue;
            clientId = newClient.id;
            created += 1;
            byName.set(name.toLowerCase(), clientId);
            if (key) byExternal.set(key.toLowerCase(), clientId);
            if (digits(t.phone)) byPhone.set(digits(t.phone), clientId);
          }

          const direction = normDirection(t.direction);
          rows.push({
            client_id: clientId,
            turn_id: t.turn_id,
            channel,
            direction,
            provider: t.provider ?? PROVIDER[channel],
            provider_message_id: t.turn_id,
            subject: t.subject ?? null,
            body: t.message_text ?? null,
            status: t.status ?? (direction === "inbound" ? "received" : "sent"),
            notified_ar: t.notified_ar ?? false,
            promise_recorded: t.promise_recorded ?? false,
            has_attachment: t.has_attachment ?? false,
            duration_seconds: t.duration_seconds ?? null,
            recording_url: t.recording_url ?? null,
            transcript: t.transcript ?? null,
            agent_name: t.agent_name ?? null,
            occurred_at: toIso(t.timestamp),
          });
        }

        let stored = 0;
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const { data, error } = await supabaseAdmin
            .from("messages")
            .upsert(chunk as { channel: string }[], { onConflict: "turn_id" })
            .select("id");
          if (error) {
            console.error("n8n conversation upsert failed", error.message);
            return Response.json({ error: "Could not store conversation" }, { status: 500 });
          }
          stored += data?.length ?? 0;
        }

        return Response.json({ ok: true, received: turns.length, stored, clients_created: created });
      },
    },
  },
});
