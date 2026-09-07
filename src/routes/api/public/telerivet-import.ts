import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  project_id: z.string().min(4).max(64).default("0c188306"),
  // "sms" | "viber" — Telerivet routes both; we tag stored rows with this channel
  // unless the message itself reports a message_type we understand.
  default_channel: z.enum(["sms", "viber"]).default("sms"),
  max_messages: z.number().int().min(1).max(2000).default(500),
});

type TelerivetMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  status?: string;
  message_type?: string;
  content?: string;
  from_number?: string;
  to_number?: string;
  time_created?: number;
  error_message?: string;
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

function channelFor(m: TelerivetMessage, fallback: "sms" | "viber") {
  const t = (m.message_type ?? "").toLowerCase();
  if (t.includes("viber")) return "viber";
  if (t === "sms" || t === "text") return "sms";
  return fallback;
}

export const Route = createFileRoute("/api/public/telerivet-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["N8N_WEBHOOK_SECRET"];
        const apiKey = process.env["TELERIVET_API_KEY"];
        if (!secret) return new Response("Webhook secret not configured", { status: 503 });
        if (!apiKey) return new Response("Telerivet API key not configured", { status: 503 });

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
        const { project_id, default_channel, max_messages } = parsed.data;

        const auth = `Basic ${btoa(`${apiKey}:`)}`;
        const collected: TelerivetMessage[] = [];
        let marker: string | undefined;

        while (collected.length < max_messages) {
          const url = new URL(`https://api.telerivet.com/v1/projects/${project_id}/messages`);
          url.searchParams.set("page_size", "200");
          url.searchParams.set("sort", "default");
          url.searchParams.set("sort_dir", "desc");
          if (marker) url.searchParams.set("marker", marker);

          const res = await fetch(url, { headers: { Authorization: auth } });
          if (!res.ok) {
            const detail = await res.text();
            console.error("Telerivet fetch failed", res.status, detail.slice(0, 300));
            return Response.json(
              { error: "Telerivet request failed", status: res.status },
              { status: 502 },
            );
          }
          const page = (await res.json()) as { data?: TelerivetMessage[]; next_marker?: string };
          collected.push(...(page.data ?? []));
          if (!page.next_marker || !(page.data ?? []).length) break;
          marker = page.next_marker;
        }

        const messages = collected.slice(0, max_messages);
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

        for (const m of messages) {
          const counterparty = m.direction === "incoming" ? m.from_number : m.to_number;
          const key = digits(counterparty).slice(-10);
          let clientId = key ? byPhone.get(key) : undefined;

          if (!clientId && key) {
            const { data: created } = await supabaseAdmin
              .from("clients")
              .insert({
                client_name: counterparty ?? key,
                phone: counterparty ?? key,
                source: "telerivet",
                sms_available: true,
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

          rows.push({
            client_id: clientId,
            channel: channelFor(m, default_channel),
            direction: m.direction === "incoming" ? "inbound" : "outbound",
            provider: "Telerivet",
            provider_message_id: m.id,
            body: m.content ?? null,
            status: m.status ?? (m.direction === "incoming" ? "received" : "sent"),
            error_message: m.error_message ?? null,
            occurred_at: m.time_created
              ? new Date(m.time_created * 1000).toISOString()
              : new Date().toISOString(),
          });
        }

        let imported = 0;
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const { error, data } = await supabaseAdmin
            .from("messages")
            .upsert(chunk as { channel: string }[], {
              onConflict: "channel,provider_message_id",
              ignoreDuplicates: true,
            })
            .select("id");
          if (error) {
            console.error("Telerivet import insert failed", error.message);
            return Response.json({ error: "Could not store messages" }, { status: 500 });
          }
          imported += data?.length ?? 0;
        }

        return Response.json({
          ok: true,
          fetched: messages.length,
          imported,
          unmatched,
        });
      },
    },
  },
});
