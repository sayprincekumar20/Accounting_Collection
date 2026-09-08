import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, ChannelBadge, StatusPill, StatCard } from "@/components/collections/Bits";

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
    return new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
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

function useClientDetail(clientId: string) {
  return useQuery({
    queryKey: ["client-detail", clientId],
    queryFn: async () => {
      const [clientsRes, queueRes, smsRes, voiceRes, gmailRes, promisesRes] = await Promise.all([
        fetch("/api/clients-list").then((r) => r.json()),
        fetch("/api/reminder-queue-list").then((r) => r.json()),
        fetch("/api/sms-conversations").then((r) => r.json()),
        fetch("/api/vapi-calls-list").then((r) => r.json()),
        fetch("/api/gmail-threads-list").then((r) => r.json()),
        fetch("/api/promise-history").then((r) => r.json()),
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

      const calls = (voiceRes.calls || []).filter(
        (c: { client_id: string }) => c.client_id === clientId,
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
            body: t.lastMessagePreview,
            occurred_at: t.lastMessageAt,
            status: "",
          });
        }
      }

      timeline.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

      return { client, queue, timeline, promises };
    },
    refetchInterval: 30000,
  });
}

function ClientDetail() {
  const { clientId } = Route.useParams();
  const { data, isLoading } = useClientDetail(clientId);

  if (isLoading) {
    return (
      <AppShell title="Loading…" subtitle="">
        <p className="text-sm text-muted-foreground">Loading client…</p>
      </AppShell>
    );
  }
  if (!data?.client) throw notFound();
  const { client, queue, timeline, promises } = data;

  return (
    <AppShell
      title={client.client_name}
      subtitle={`${client.parent_name ?? "Direct account"} · live`}
      actions={
        <Link
          to="/clients"
          className="rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to clients
        </Link>
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
          <Panel title="Conversation timeline" description="Everything sent and received, newest at the bottom">
            <ol className="space-y-4 p-4">
              {timeline.length === 0 ? (
                <li className="text-sm text-muted-foreground">No messages yet.</li>
              ) : null}
              {timeline.map((m, i) => {
                const outbound = m.direction === "outbound";
                return (
                  <li key={i} className={`flex flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}>
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
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
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
                      Sent {q.sent_date ? shortDate(q.sent_date) : "not yet"} · {peso(q.collection_amount)}
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
