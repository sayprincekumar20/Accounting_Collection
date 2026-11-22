export type Channel = "whatsapp" | "viber" | "sms" | "email" | "voice";

export const CHANNELS: {
  id: Channel;
  label: string;
  provider: string;
  colorVar: string;
}[] = [
  { id: "whatsapp", label: "WhatsApp", provider: "Twilio", colorVar: "var(--whatsapp)" },
  { id: "viber", label: "Viber", provider: "Telerivet", colorVar: "var(--viber)" },
  { id: "sms", label: "SMS", provider: "Telerivet", colorVar: "var(--sms)" },
  { id: "email", label: "Email", provider: "Gmail", colorVar: "var(--email)" },
  { id: "voice", label: "Voice", provider: "ElevenLabs / Vapi", colorVar: "var(--voice)" },
];

/**
 * The channel's label and colour. Matches regardless of capitals (the n8n tables store "EMAIL", "VOICE"…);
 * a callback request counts as Voice. An unknown or empty channel gets a neutral grey badge with its own
 * name, never another channel's (it used to fall back to WhatsApp, so every promise looked like WhatsApp).
 */
export function channelMeta(id: string) {
  const key = String(id ?? "")
    .trim()
    .toLowerCase();
  const norm = key === "voice_callback" || key === "call" || key === "phone" ? "voice" : key;
  const known = CHANNELS.find((c) => c.id === norm);
  if (known) return known;
  return {
    id: norm as Channel,
    label: norm ? norm.charAt(0).toUpperCase() + norm.slice(1).replace(/_/g, " ") : "Unknown",
    provider: "",
    colorVar: "var(--muted-foreground)",
  };
}

export function peso(value: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function daysOverdue(due: string | null) {
  if (!due) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(due).getTime()) / 86400000));
}
