import { supabase } from "@/integrations/supabase/client";
import { queryOptions } from "@tanstack/react-query";

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

export function channelMeta(id: string) {
  return CHANNELS.find((c) => c.id === id) ?? CHANNELS[0]!;
}

export interface ClientRow {
  id: string;
  external_id: string | null;
  client_name: string;
  parent_name: string | null;
  email: string | null;
  phone: string | null;
  viber_available: boolean;
  whatsapp_available: boolean;
  gmail_available: boolean;
  sms_available: boolean;
  voice_available: boolean;
  collection_amount: number;
  due_date: string | null;
  status: string;
  invoice_numbers: string | null;
  branches: string | null;
  ar_owner: string | null;
  credit_terms: string | null;
  credit_limit: number | null;
  source: string | null;
}

export interface MessageRow {
  id: string;
  client_id: string | null;
  channel: string;
  direction: string;
  provider: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  error_message: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  recording_url: string | null;
  provider_message_id: string | null;
  agent_name: string | null;
  assistant_id: string | null;
  promise_recorded: boolean;
  notified_ar: boolean;
  has_attachment: boolean;
  occurred_at: string;
}

export interface QueueRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  preferred_channel: string;
  queue_status: string;
  fallback_channel: string | null;
  fallback_status: string | null;
  collection_amount: number;
  due_date: string | null;
  invoice_numbers: string | null;
  attempted_date: string | null;
  sent_date: string | null;
}

export interface RunLogRow {
  id: string;
  run_date: string;
  total_processed: number;
  total_outstanding: number;
  viber_queued: number;
  email_queued: number;
  whatsapp_queued: number;
  sms_queued: number;
  voice_queued: number;
  no_contact_count: number;
  no_contact_amount: number;
  email_only_count: number;
  email_only_amount: number;
  skipped_cooldown: number;
  summary_text: string | null;
}

export interface CounterRow {
  id: string;
  channel: string;
  date: string;
  sent_count: number;
  daily_limit: number;
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as T;
}

export const clientsQuery = queryOptions({
  queryKey: ["clients"],
  queryFn: () =>
    unwrap<ClientRow[]>(
      supabase.from("clients").select("*").order("collection_amount", { ascending: false }),
    ),
});

export const messagesQuery = queryOptions({
  queryKey: ["messages"],
  queryFn: () =>
    unwrap<MessageRow[]>(
      supabase.from("messages").select("*").order("occurred_at", { ascending: false }).limit(500),
    ),
});

export const queueQuery = queryOptions({
  queryKey: ["reminder_queue"],
  queryFn: () =>
    unwrap<QueueRow[]>(
      supabase.from("reminder_queue").select("*").order("created_at", { ascending: false }),
    ),
});

export const runLogsQuery = queryOptions({
  queryKey: ["daily_run_logs"],
  queryFn: () =>
    unwrap<RunLogRow[]>(
      supabase.from("daily_run_logs").select("*").order("run_date", { ascending: false }),
    ),
});

export const countersQuery = queryOptions({
  queryKey: ["channel_counters"],
  queryFn: () =>
    unwrap<CounterRow[]>(supabase.from("channel_counters").select("*").order("channel")),
});

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
