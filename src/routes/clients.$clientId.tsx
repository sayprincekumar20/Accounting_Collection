import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefTag } from "@/components/collections/LogCells";
import { downloadCsv } from "@/lib/csv";
import { AppShell } from "@/components/AppShell";
import {
  Panel,
  ChannelBadge,
  StatusPill,
  StatCard,
  RefreshButton,
} from "@/components/collections/Bits";

export const Route = createFileRoute("/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "Client Conversation Timeline | Rare Global Food" },
      {
        name: "description",
        content:
          "Full communication history for a single account across SMS, Email and voice calls, synced live.",
      },
      { property: "og:title", content: "Client Conversation Timeline | Rare Global Food" },
    ],
  }),
  component: ClientDetail,
});

interface ClientRow {
  client_id: string;
  client_name: string;
  parent_name: string;
  contact_person: string;
  email: string;
  phone: string;
  gmail_available: boolean;
  sms_available: boolean;
  voice_available: boolean;
  whatsapp_available: boolean;
  viber_available: boolean;
  collection_amount: number;
  due_date: string;
  status: string;
  invoice_numbers: string;
  credit_terms: string;
  credit_limit: number | null;
}
interface QueueRow {
  queue_id: string;
  client_id: string;
  preferred_channel: string;
  queue_status: string;
  collection_amount: number;
  sent_date: string;
}
interface PromiseRow {
  client_id: string;
  channel: string;
  promise_date: string;
  reason: string;
  recorded_at: string;
}

function peso(v: number) {
  return "PHP " + Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}
function shortDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return v;
  }
}
function daysOverdue(v: string | null | undefined) {
  if (!v) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 86400000));
}
function digits(v: string | null | undefined) {
  return (v || "").replace(/\D/g, "");
}

interface TimelineItem {
  channel: string;
  direction: "outbound" | "inbound";
  body: string;
  occurred_at: string;
  status: string;
}

function reasonLabel(reason: string) {
  const map: Record<string, string> = {
    payment_promise: "Promise to Pay",
    investigation_hold: "Investigation Hold",
    client_unavailable: "Client Unavailable",
    business_closed_pending_review: "Business Closed (Pending Review)",
  };
  return map[reason] ?? reason;
}

async function safeFetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[client-detail] ${url} returned ${res.status}`);
      return fallback;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[client-detail] ${url} failed:`, err);
    return fallback;
  }
}

function useClientDetail(clientId: string) {
  return useQuery({
    queryKey: ["client-detail", clientId],
    queryFn: async () => {
      const [clientsRes, queueRes, smsRes, voiceRes, gmailRes, promisesRes, viberRes] =
        await Promise.all([
          safeFetchJson("/api/clients-list", { clients: [] as ClientRow[] }),
          safeFetchJson("/api/reminder-queue-list", { queue: [] as QueueRow[] }),
          safeFetchJson("/api/sms-conversations", {
            conversations: [] as { client_id: string; messages: any[] }[],
          }),
          safeFetchJson("/api/vapi-calls-list", { calls: [] as any[] }),
          safeFetchJson("/api/gmail-threads-list", { threads: [] as any[] }),
          safeFetchJson("/api/promise-history", { promises: [] as PromiseRow[] }),
          safeFetchJson("/api/viber-conversations", {
            conversations: [] as { client_id: string; messages: any[] }[],
          }),
        ]);

      const client = (clientsRes.clients as ClientRow[]).find((c) => c.client_id === clientId);
      const queue = (queueRes.queue as QueueRow[]).filter((q) => q.client_id === clientId);
      const promises = (promisesRes.promises as PromiseRow[]).filter(
        (p) => p.client_id === clientId,
      );

      const timeline: TimelineItem[] = [];

      if (client?.phone) {
        const phoneDigits = digits(client.phone);
        const conv = (smsRes.conversations || []).find(
          (c: { client_id: string }) => digits(c.client_id) === phoneDigits,
        );
        if (conv) {
          for (const m of conv.messages) {
            timeline.push({
              channel: "sms",
              direction: m.role === "ai" ? "outbound" : "inbound",
              body: m.content,
              occurred_at: m.ts,
              status: m.status || "",
            });
          }
        }
      }

      // Viber conversation (reminders from "Rare Global Food", client replies, AI answers).
      if (client?.phone) {
        const phoneDigits = digits(client.phone);
        const vconv = (viberRes.conversations || []).find(
          (c: { client_id: string }) => digits(c.client_id) === phoneDigits,
        );
        for (const m of vconv?.messages || []) {
          timeline.push({
            channel: "viber",
            direction: m.role === "ai" ? "outbound" : "inbound",
            body: m.content,
            occurred_at: m.ts,
            status: m.status || "",
          });
        }
      }

      // Calls of this client (also under an earlier client_id, e.g. after a contact change).
      const companyKey = clientId.split("___")[0]!.trim().toLowerCase();
      const calls = (voiceRes.calls || []).filter(
        (c: { client_id: string }) =>
          c.client_id === clientId ||
          String(c.client_id || "")
            .split("___")[0]!
            .trim()
            .toLowerCase() === companyKey,
      );
      for (const c of calls) {
        timeline.push({
          channel: "voice",
          direction: "outbound",
          body: c.preview || `Call ${c.endedReason || c.status}`,
          occurred_at: c.startedAt,
          status: c.status,
        });
      }

      if (client) {
        const nameLower = client.client_name.toLowerCase();
        const emailLower = (client.email || "").toLowerCase();
        const threads = (gmailRes.threads || []).filter(
          (t: { client_name: string }) =>
            (emailLower && t.client_name.toLowerCase().includes(emailLower)) ||
            t.client_name.toLowerCase().includes(nameLower) ||
            nameLower.includes(t.client_name.toLowerCase()),
        );
        for (const t of threads) {
          timeline.push({
            channel: "email",
            direction: t.lastDirection,
            body: (t.subject ? t.subject + ": " : "") + t.lastMessagePreview,
            occurred_at: t.lastMessageAt,
            status: "",
          });
        }
      }

      timeline.sort(
        (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
      );

      return { client, queue, timeline, promises, calls };
    },
    refetchInterval: 14400000, // 4 hours -- see hard-refresh button for on-demand updates
  });
}

function ClientDetail() {
  const { clientId } = Route.useParams();
  const { data, isLoading, isFetching, isError, error, refetch } = useClientDetail(clientId);

  if (isLoading) {
    return (
      <AppShell title="Loading…" subtitle="">
        <p className="text-sm text-muted-foreground">Loading client…</p>
      </AppShell>
    );
  }
  if (isError) {
    return (
      <AppShell title="Couldn't load this client" subtitle="">
        <div className="surface-card p-6 text-sm">
          <p className="font-semibold text-destructive">
            Something went wrong loading this client's data.
          </p>
          <p className="mt-1 text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error. Check the server logs."}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            This is usually a backend connectivity issue (e.g. a missing or incorrect
            N8N_WEBHOOK_BASE_URL environment variable), not a missing client record.
          </p>
        </div>
      </AppShell>
    );
  }
  // Only throw a real 404 once the query actually succeeded and no matching client exists -
  // never conflate "the data fetch failed" with "this client doesn't exist".
  if (!data?.client) throw notFound();
  const { client, queue, timeline, promises } = data;

  return (
    <AppShell
      title={client.client_name}
      subtitle={`${client.parent_name ?? "Direct account"} · live`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/clients"
            className="rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Back to clients
          </Link>
          <RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Amount due" value={peso(client.collection_amount)} tone="primary" />
        <StatCard
          label="Days overdue"
          value={String(daysOverdue(client.due_date))}
          hint={`Due ${shortDate(client.due_date)}`}
        />
        <StatCard label="Messages" value={String(timeline.length)} hint="All channels" />
        <StatCard
          label="Payment promises"
          value={String(promises.length)}
          hint={promises[0] ? `Latest: ${shortDate(promises[0].promise_date)}` : "None recorded"}
        />
        <StatCard
          label="Credit limit"
          value={client.credit_limit ? peso(client.credit_limit) : "—"}
          hint={client.credit_terms ?? "No terms on file"}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel
            title="Conversation timeline"
            description="Everything sent and received, newest at the bottom"
          >
            <ol className="space-y-4 p-4">
              {timeline.length === 0 ? (
                <li className="text-sm text-muted-foreground">No messages yet.</li>
              ) : null}
              {timeline.map((m, i) => {
                const outbound = m.direction === "outbound";
                return (
                  <li
                    key={i}
                    className={`flex flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-center gap-2">
                      <ChannelBadge channel={m.channel} />
                      <span className="text-[11px] text-muted-foreground">
                        {shortDate(m.occurred_at)}
                      </span>
                    </div>
                    <div
                      className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 text-sm ${
                        outbound
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-border bg-muted"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                    {m.status ? <StatusPill status={m.status} /> : null}
                  </li>
                );
              })}
            </ol>
          </Panel>
          <div className="mt-5">
            <ClientCalls calls={data?.calls ?? []} />
          </div>
          <div className="mt-5">
            <ClientHistory clientId={clientId} />
          </div>
        </div>

        <div className="space-y-5">
          <Panel title="Account details">
            <dl className="divide-y divide-border text-sm">
              {[
                ["Contact person", client.contact_person || "Not on file"],
                ["Email", client.email || "Not on file"],
                ["Phone", client.phone || "Not on file"],
                ["Invoices", client.invoice_numbers || "—"],
              ].map(([label, value]) => (
                <div key={label} className="px-4 py-2.5">
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-0.5 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Reachable channels">
            <div className="flex flex-wrap gap-2 p-4">
              {[
                ["whatsapp", client.whatsapp_available],
                ["viber", client.viber_available],
                ["sms", client.sms_available],
                ["email", client.gmail_available],
                ["voice", client.voice_available],
              ].map(([id, ok]) =>
                ok ? (
                  <ChannelBadge key={id as string} channel={id as string} />
                ) : (
                  <span
                    key={id as string}
                    className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground line-through"
                  >
                    {id as string}
                  </span>
                ),
              )}
            </div>
          </Panel>

          <Panel title="Payment promises" description="Recorded by the AI reply agent">
            {promises.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                No payment promises recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {promises.map((p, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{reasonLabel(p.reason)}</span>
                      <ChannelBadge channel={p.channel} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Committed to pay by {shortDate(p.promise_date)} · recorded{" "}
                      {shortDate(p.recorded_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {queue.length ? (
            <Panel title="Queue entries">
              <ul className="divide-y divide-border text-sm">
                {queue.map((q) => (
                  <li key={q.queue_id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <ChannelBadge channel={q.preferred_channel.toLowerCase()} />
                      <StatusPill status={q.queue_status.toLowerCase()} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sent {q.sent_date ? shortDate(q.sent_date) : "not yet"} ·{" "}
                      {peso(q.collection_amount)}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

// Everything that happened with this client, newest first: reminders, calls, messages, promises,
// AR escalations (with the Cliq Ref) and failures.
interface HistoryEvent {
  at: string;
  kind: string;
  channel: string;
  title: string;
  detail: string;
  ref?: string;
  source?: string;
}
const KIND_TONE: Record<string, string> = {
  reminder: "bg-secondary text-secondary-foreground",
  call: "bg-primary/10 text-primary",
  client: "bg-muted text-foreground",
  ai: "bg-primary/10 text-primary",
  promise: "bg-success/12 text-success",
  escalation: "bg-destructive/12 text-destructive",
  failure: "bg-warning/15 text-warning",
};
function ClientHistory({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["client-timeline", clientId],
    queryFn: async () => {
      const r = await fetch(`/api/client-timeline?client_id=${encodeURIComponent(clientId)}`);
      if (!r.ok) throw new Error("Timeline fetch failed");
      return ((await r.json()).events ?? []) as HistoryEvent[];
    },
  });
  const events = data ?? [];
  return (
    <Panel
      title="Full history"
      description="Reminders, calls, messages, promises and AR escalations, newest first"
      action={
        events.length ? (
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                `history-${clientId.split("___")[0]}`,
                ["When", "Type", "Channel", "Event", "Details", "Ref", "Source"],
                events.map((e) => [
                  e.at,
                  e.kind,
                  e.channel,
                  e.title,
                  e.detail,
                  e.ref || "",
                  e.source || "",
                ]),
              )
            }
            className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
          >
            Export CSV
          </button>
        ) : undefined
      }
    >
      {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
      {error ? (
        <p className="px-4 py-6 text-sm text-destructive">Could not load the history.</p>
      ) : null}
      {!isLoading && !error && events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : null}
      <ol className="max-h-[520px] divide-y divide-border overflow-y-auto">
        {events.map((e, i) => (
          <li key={i} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KIND_TONE[e.kind] ?? "bg-muted"}`}
              >
                {e.title}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {e.at
                  ? new Date(e.at).toLocaleString("en-PH", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : ""}
                {e.source ? ` · ${e.source}` : ""}
              </span>
            </div>
            {e.detail ? (
              <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm">{e.detail}</p>
            ) : null}
            <RefTag refId={e.ref} className="mt-1" />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// Every call to this client (weekly run, /call from Cliq, retries): outcome, summary, and the full
// transcript + recording on demand (loaded only when opened, so the page stays fast).
interface CallItem {
  call_id: string;
  startedAt: string;
  endedAt: string;
  endedReason: string;
  status: string;
  callSummary?: string;
  satisfactionOverall?: number | null;
  assistantName?: string;
  triggerSource?: string;
  requestedBy?: string;
}
const CALL_OUTCOME: Record<string, string> = {
  "customer-ended-call": "Answered (client ended)",
  "assistant-ended-call": "Answered (Grace ended)",
  "customer-did-not-answer": "No answer",
  "customer-busy": "Busy / declined",
  "silence-timed-out": "No response (silence)",
  voicemail: "Voicemail",
  "twilio-failed-to-connect-call": "Line failed",
};
function ClientCalls({ calls }: { calls: CallItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...calls].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  const src = (c: CallItem) => {
    const t = String(c.triggerSource || "").toUpperCase();
    if (t === "CLIQ_CALL") return "/call" + (c.requestedBy ? " · " + c.requestedBy : "");
    if (t === "RETRY") return "Automatic retry";
    return t ? "Weekly run" : "";
  };
  return (
    <Panel
      title={`Calls (${sorted.length})`}
      description="Every call by Grace, newest first: outcome, summary, transcript and recording"
    >
      {sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No calls in the last 14 days.</p>
      ) : null}
      <ul className="divide-y divide-border">
        {sorted.map((c) => {
          const secs =
            c.endedAt && c.startedAt
              ? Math.max(
                  0,
                  Math.round(
                    (new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime()) / 1000,
                  ),
                )
              : 0;
          return (
            <li key={c.call_id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">
                  {c.startedAt
                    ? new Date(c.startedAt).toLocaleString("en-PH", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : ""}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
                  {CALL_OUTCOME[c.endedReason] || c.endedReason || c.status}
                </span>
                {secs ? (
                  <span className="text-muted-foreground">
                    {Math.floor(secs / 60)}m {secs % 60}s
                  </span>
                ) : null}
                {src(c) ? <span className="text-muted-foreground">· {src(c)}</span> : null}
                {c.assistantName ? (
                  <span className="text-muted-foreground">· {c.assistantName}</span>
                ) : null}
                {c.satisfactionOverall != null ? (
                  <span className="text-muted-foreground">
                    · satisfaction {c.satisfactionOverall}/5
                  </span>
                ) : null}
              </div>
              {c.callSummary ? <p className="mt-1 text-sm">{c.callSummary}</p> : null}
              <button
                type="button"
                onClick={() => setOpen(open === c.call_id ? null : c.call_id)}
                className="mt-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-semibold hover:bg-muted"
              >
                {open === c.call_id ? "Hide transcript" : "Transcript & recording"}
              </button>
              {open === c.call_id ? <CallTranscript callId={c.call_id} /> : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
function CallTranscript({ callId }: { callId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["vapi-call-detail", callId],
    queryFn: async () => {
      const r = await fetch(`/api/vapi-call-detail?callId=${encodeURIComponent(callId)}`);
      if (!r.ok) throw new Error("Call detail fetch failed");
      return (await r.json()) as {
        recordingUrl?: string;
        turns?: { role: string; text: string }[];
      };
    },
  });
  if (isLoading) return <p className="mt-2 text-xs text-muted-foreground">Loading…</p>;
  if (error || !data)
    return <p className="mt-2 text-xs text-destructive">Could not load this call.</p>;
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3">
      {data.recordingUrl ? (
        <audio controls preload="none" src={data.recordingUrl} className="w-full" />
      ) : (
        <p className="text-xs text-muted-foreground">No recording for this call.</p>
      )}
      {(data.turns ?? []).length ? (
        <ol className="max-h-72 space-y-1 overflow-y-auto text-sm">
          {(data.turns ?? []).map((t, i) => (
            <li key={i}>
              <span className="font-semibold">{t.role === "client" ? "Client" : "Grace"}:</span>{" "}
              {t.text}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          No conversation (the call was not answered).
        </p>
      )}
    </div>
  );
}
