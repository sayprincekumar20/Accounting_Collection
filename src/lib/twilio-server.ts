// src/lib/twilio-server.ts
// SERVER-ONLY. Uses TWILIO_AUTH_TOKEN — must never reach the client bundle.
//
// Env vars required (server-side, NOT VITE_-prefixed):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_NUMBER   your WhatsApp-enabled Twilio number, e.g. "whatsapp:+1415XXXXXXX"
//                            used to filter Messages.json to just this channel

const TWILIO_API = "https://api.twilio.com/2010-04-01";

function authHeader() {
  const sid = process.env["TWILIO_ACCOUNT_SID"] || "";
  const token = process.env["TWILIO_AUTH_TOKEN"] || "";
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
}

/**
 * Fetches recent messages for the account, paginating via Twilio's
 * next_page_uri. Bounded to maxPages so this stays a "recent activity"
 * view, not a full historical export.
 */
export async function fetchRecentWhatsAppMessages(opts: {
  pageSize?: number;
  maxPages?: number;
}): Promise<TwilioMessage[]> {
  const sid = process.env["TWILIO_ACCOUNT_SID"] || "";
  const pageSize = opts.pageSize ?? 200;
  const maxPages = opts.maxPages ?? 5;

  const all: TwilioMessage[] = [];
  let nextUrl: string | null =
    `${TWILIO_API}/Accounts/${sid}/Messages.json?PageSize=${pageSize}`;

  for (let page = 0; page < maxPages && nextUrl; page++) {
    const res = await fetch(nextUrl, { headers: authHeader() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Twilio messages fetch failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { messages: TwilioMessage[]; next_page_uri: string | null };
    all.push(...(data.messages || []));
    nextUrl = data.next_page_uri ? `https://api.twilio.com${data.next_page_uri}` : null;
  }

  // Only keep messages actually on the WhatsApp channel (from/to prefixed "whatsapp:")
  return all.filter((m) => m.from?.startsWith("whatsapp:") || m.to?.startsWith("whatsapp:"));
}
