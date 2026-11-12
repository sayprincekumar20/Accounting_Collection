// "Contact" on the Clients module: which channels can reach this client, and its most recent conversation on a
// channel (Viber / SMS / WhatsApp are keyed by phone digits, email threads by client id). Pure, unit-tested.
export type ContactChannel = "email" | "viber" | "sms" | "whatsapp" | "call";
export interface ContactClient {
  client_id: string;
  client_name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
}
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const companyKey = (id: unknown) => s(id).split("___")[0]!.trim().toLowerCase();
const last10 = (v: unknown) => s(v).replace(/\D/g, "").slice(-10);

/** "639171234567" for a valid Philippine mobile number, else "". */
export function normalizePhMobile(raw?: string): string {
  const d = s(raw).replace(/\D/g, "");
  const f =
    d.length >= 12
      ? d
      : d.length === 11 && d.startsWith("0")
        ? "63" + d.slice(1)
        : d.length === 10
          ? "63" + d
          : d;
  return /^639\d{9}$/.test(f) ? f : "";
}

const validEmail = (e?: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(e).trim());

export function channelOptions(c: ContactClient) {
  const phone = !!normalizePhMobile(c.phone);
  const noPhone = c.phone ? "phone number is not a valid PH mobile" : "no phone number on file";
  return [
    { channel: "viber" as const, label: "Viber", available: phone, why: noPhone },
    { channel: "sms" as const, label: "SMS", available: phone, why: noPhone },
    { channel: "whatsapp" as const, label: "WhatsApp", available: phone, why: noPhone },
    {
      channel: "email" as const,
      label: "Email",
      available: validEmail(c.email),
      why: c.email ? "email address is not valid" : "no email on file",
    },
    { channel: "call" as const, label: "Call", available: phone, why: noPhone },
  ];
}

export interface FoundConversation {
  /** Value for ?open= on the channel page (phone digits or thread id). */
  open: string;
  lastAt: string;
  preview: string;
}

const time = (v: unknown) => new Date(s(v)).getTime() || 0;

/** Most recent Viber / SMS / WhatsApp conversation with this client's phone. */
export function findPhoneConversation(
  c: ContactClient,
  convs: unknown[],
): FoundConversation | null {
  const want = last10(c.phone);
  if (want.length < 10) return null;
  const hits = convs
    .filter((x): x is Row => !!x && typeof x === "object")
    .filter((x) => last10(x["client_id"]) === want)
    .sort((a, b) => time(b["lastMessageAt"]) - time(a["lastMessageAt"]));
  const h = hits[0];
  if (!h) return null;
  const msgs = Array.isArray(h["messages"]) ? (h["messages"] as Row[]) : [];
  const last = msgs[msgs.length - 1];
  return {
    open: s(h["client_id"]),
    lastAt: s(h["lastMessageAt"]),
    preview: s(last?.["content"] ?? h["lastMessagePreview"]).slice(0, 200),
  };
}

/** Most recent email thread with this client (same company). */
export function findEmailThread(c: ContactClient, threads: unknown[]): FoundConversation | null {
  const want = companyKey(c.client_id);
  if (!want) return null;
  const h = threads
    .filter((x): x is Row => !!x && typeof x === "object")
    .filter((t) => s(t["thread_id"]) && companyKey(t["client_id"]) === want)
    .sort((a, b) => time(b["lastMessageAt"]) - time(a["lastMessageAt"]))[0];
  if (!h) return null;
  return {
    open: s(h["thread_id"]),
    lastAt: s(h["lastMessageAt"]),
    preview: s(h["lastMessagePreview"]).slice(0, 200),
  };
}
