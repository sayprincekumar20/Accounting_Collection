import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  limit: z.number().int().min(1).max(1000).default(200),
  assistant_id: z.string().min(4).max(80).optional(),
});

type VapiMessage = { role?: string; message?: string; time?: number };

type VapiCall = {
  id: string;
  type?: string;
  status?: string;
  endedReason?: string;
  startedAt?: string;
  createdAt?: string;
  endedAt?: string;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  artifact?: { transcript?: string; recordingUrl?: string; messages?: VapiMessage[] };
  analysis?: { summary?: string };
  assistant?: { name?: string };
  assistantId?: string;
  customer?: { number?: string; name?: string };
};

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function digits(value: string | undefined | null) {
  return (value ?? "").replace(/\D/g, "");
}

function seconds(call: VapiCall) {
  if (!call.startedAt || !call.endedAt) return null;
  const d = (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
}

function statusFor(call: VapiCall) {
  const reason = (call.endedReason ?? "").toLowerCase();
  if (reason.includes("no-answer") || reason.includes("did-not-answer")) return "no_answer";
  if (reason.includes("busy")) return "no_answer";
  if (reason.includes("error") || reason.includes("failed")) return "failed";
  if (call.status === "ended" || reason.includes("customer")) return "completed";
  return call.status ?? "queued";
}

function transcriptFor(call: VapiCall) {
  const raw = call.artifact?.transcript ?? call.transcript;
  if (raw) return raw;
  const turns = call.artifact?.messages ?? [];
  const lines = turns
    .filter((t) => t.role === "bot" || t.role === "user" || t.role === "assistant")
    .map((t) => `${t.role === "user" ? "Client" : "Agent"}: ${t.message ?? ""}`.trim());
  return lines.length ? lines.join("\n") : null;
}

export const Route = createFileRoute("/api/public/vapi-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["N8N_WEBHOOK_SECRET"];
        const apiKey = process.env["VAPI_API_KEY"];
        if (!secret) return new Response("Webhook secret not configured", { status: 503 });
        if (!apiKey) return new Response("Vapi API key not configured", { status: 503 });

        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!timingSafeEqualStr(provided, secret)) {
          return new Response("Invalid webhook secret", { status: 401 });
        }

        let json: unknown = {};
        try {
          const text = await request.text();
          json = text ? JSON.parse(text) : {};
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
        const { limit, assistant_id } = parsed.data;

        const url = new URL("https://api.vapi.ai/call");
        url.searchParams.set("limit", String(Math.min(limit, 1000)));
        if (assistant_id) url.searchParams.set("assistantId", assistant_id);

        const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!res.ok) {
          const detail = await res.text();
          console.error("Vapi fetch failed", res.status, detail.slice(0, 300));
          return Response.json({ error: "Vapi request failed", status: res.status }, { status: 502 });
        }

        const calls = (await res.json()) as VapiCall[];
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, client_name, phone");

        const byPhone = new Map<string, string>();
        for (const c of clients ?? []) {
          const key = digits(c.phone).slice(-10);
          if (key) byPhone.set(key, c.id);
        }

        const rows: Record<string, unknown>[] = [];
        let unmatched = 0;

        for (const call of calls) {
          const number = call.customer?.number ?? "";
          const key = digits(number).slice(-10);
          let clientId = key ? byPhone.get(key) : undefined;

          if (!clientId && key) {
            const { data: created } = await supabaseAdmin
              .from("clients")
              .insert({
                client_name: call.customer?.name ?? number,
                phone: number,
                source: "vapi",
                voice_available: true,
                status: "unassigned",
              })
              .select("id")
              .maybeSingle();
            if (created?.id) {
              clientId = created.id;
              byPhone.set(key, created.id);
            }
          }
          if (!clientId) {
            unmatched += 1;
            continue;
          }

          const transcript = transcriptFor(call);
          const summary = call.analysis?.summary ?? call.summary ?? null;

          rows.push({
            client_id: clientId,
            channel: "voice",
            direction: (call.type ?? "").toLowerCase().includes("inbound") ? "inbound" : "outbound",
            provider: "Vapi",
            provider_message_id: call.id,
            subject: call.endedReason ? `Call ended: ${call.endedReason}` : "AI voice call",
            body: summary ?? transcript ?? "Voice call logged",
            status: statusFor(call),
            duration_seconds: seconds(call),
            recording_url: call.artifact?.recordingUrl ?? call.recordingUrl ?? null,
            transcript,
            agent_name: call.assistant?.name ?? "Accounting Assistant",
            assistant_id: call.assistantId ?? assistant_id ?? null,
            occurred_at: call.startedAt ?? call.createdAt ?? new Date().toISOString(),
          });
        }

        let imported = 0;
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const { error, data } = await supabaseAdmin
            .from("messages")
            .upsert(chunk as { channel: string }[], {
              onConflict: "channel,provider_message_id",
            })
            .select("id");
          if (error) {
            console.error("Vapi import insert failed", error.message);
            return Response.json({ error: "Could not store calls" }, { status: 500 });
          }
          imported += data?.length ?? 0;
        }

        return Response.json({ ok: true, fetched: calls.length, imported, unmatched });
      },
    },
  },
});
