// src/lib/twilio-server.ts
// SERVER-ONLY. Uses TWILIO_AUTH_TOKEN — must never reach the client bundle.
//
// Env vars required (server-side, NOT VITE_-prefixed):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_NUMBER   your WhatsApp-enabled Twilio number, e.g. "whatsapp:+1415XXXXXXX"
//                            used to filter Messages.json to just this channel

import { getEnv } from "@/lib/env";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

async function authHeader() {
  const sid = ((await getEnv("TWILIO_ACCOUNT_SID")) || "").trim();
  const token = ((await getEnv("TWILIO_AUTH_TOKEN")) || "").trim();
  if (!sid || !token)
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be configured");
  return { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
}

export interface TwilioMessage {
  sid: string;
  from: string;
  to: string;
  body: string;
  date_sent: string | null;
  date_created: string;
  direction: string; // "inbound" | "outbound-api" | "outbound-call" | "outbound-reply"
  status: string;
  error_code?: number | string | null;
  error_message?: string | null;
}

/**
 * Fetches recent messages for the account, paginating via Twilio's
 * next_page_uri. Bounded to maxPages so this stays a "recent activity"
 * view, not a full historical export.
 */
export async function sendTwilioWhatsAppMessage(opts: {
  to: string;
  body: string;
  from?: string;
  mediaUrls?: string[];
}): Promise<{ sid?: string; status?: string }> {
  const sid = ((await getEnv("TWILIO_ACCOUNT_SID")) || "").trim();
  if (!sid) throw new Error("TWILIO_ACCOUNT_SID is not configured");

  const configuredFrom = (opts.from || (await getEnv("TWILIO_WHATSAPP_NUMBER")) || "").trim();
  if (!configuredFrom) throw new Error("TWILIO_WHATSAPP_NUMBER is not configured");
  const fromNumber = configuredFrom.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  const from = `whatsapp:${fromNumber.startsWith("+") ? fromNumber : `+${fromNumber}`}`;

  const toNumber = opts.to
    .trim()
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d+]/g, "");
  if (!toNumber) throw new Error("A valid WhatsApp destination number is required");
  const params = new URLSearchParams();
  params.set("From", from);
  params.set("To", `whatsapp:${toNumber.startsWith("+") ? toNumber : `+${toNumber}`}`);
  if (opts.body) params.set("Body", opts.body);
  for (const mediaUrl of opts.mediaUrls || []) params.append("MediaUrl", mediaUrl);
  if (!opts.body && !opts.mediaUrls?.length)
    throw new Error("Message text or an attachment is required");

  const res = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      ...(await authHeader()),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twilio send failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { sid?: string; status?: string };
  return data;
}

export async function fetchRecentWhatsAppMessages(opts: {
  pageSize?: number;
  maxPages?: number;
  from?: string; // e.g. "whatsapp:+639453450025" -- Twilio-side filter
  to?: string;
}): Promise<TwilioMessage[]> {
  const sid = ((await getEnv("TWILIO_ACCOUNT_SID")) || "").trim();
  if (!sid) throw new Error("TWILIO_ACCOUNT_SID is not configured");
  const pageSize = opts.pageSize ?? 200;
  const maxPages = opts.maxPages ?? 5;

  const params = new URLSearchParams({ PageSize: String(pageSize) });
  if (opts.from) params.set("From", opts.from);
  if (opts.to) params.set("To", opts.to);

  const all: TwilioMessage[] = [];
  let nextUrl: string | null = `${TWILIO_API}/Accounts/${sid}/Messages.json?${params.toString()}`;

  for (let page = 0; page < maxPages && nextUrl; page++) {
    const res = await fetch(nextUrl, { headers: await authHeader() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Twilio messages fetch failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { messages: TwilioMessage[]; next_page_uri: string | null };
    all.push(...(data.messages || []));
    nextUrl = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : null;
  }

  // Only keep messages actually on the WhatsApp channel (from/to prefixed "whatsapp:")
  return all.filter((m) => m.from?.startsWith("whatsapp:") || m.to?.startsWith("whatsapp:"));
}
