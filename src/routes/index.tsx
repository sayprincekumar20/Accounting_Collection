import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { StatCard, Panel, ChannelBadge, StatusPill } from "@/components/collections/Bits";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Collections Overview | Rare Global Food Communications Hub" },
      {
        name: "description",
        content:
          "Live overdue-reminder overview across SMS, Email and Voice for Rare Global Food accounts receivable.",
      },
      { property: "og:title", content: "Collections Overview | Rare Global Food" },
    ],
  }),
  component: Overview,
});

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", colorVar: "#25D366" },
  { id: "viber", label: "Viber", colorVar: "#7360F2" },
  { id: "sms", label: "SMS", colorVar: "#0EA5E9" },
  { id: "email", label: "Email", colorVar: "#F59E0B" },
  { id: "voice", label: "Voice", colorVar: "#EF4444" },
];

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
function timeAgo(v: string) {
  const diff = Date.now() - new Date(v).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
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

function useOverviewData() {
  return useQuery({
    queryKey: ["overview-data"],
    queryFn: async () => {
      const [clientsRes, queueRes, countersRes, runsRes, smsRes, voiceRes, gmailRes, promisesRes] =
        await Promise.all([
          fetch("/api/clients-list").then((r) => r.json()),
          fetch("/api/reminder-queue-list").then((r) => r.json()),
          fetch("/api/channel-counters").then((r) => r.json()),
          fetch("/api/daily-run-logs").then((r) => r.json()),
          fetch("/api/sms-conversations").then((r) => r.json()),
          fetch("/api/vapi-calls-list").then((r) => r.json()),
          fetch("/api/gmail-threads-list").then((r) => r.json()),
          fetch("/api/promise-history").then((r) => r.json()),
        ]);

      const clients = clientsRes.clients || [];
      const queue = queueRes.queue || [];
      const counters = countersRes.counters || [];
      const latestRun = (runsRes.runs || [])[0];
      const promises = (promisesRes.promises || []).slice(0, 6);

      const recent: {
        channel: string;
        client_name: string;
        preview: string;
        direction: string;
        occurred_at: string;
        status: string;
      }[] = [];

      for (const c of smsRes.conversations || []) {
        const last = c.messages[c.messages.length - 1];
        if (last) {
          recent.push({
            channel: "sms",
            client_name: c.client_name,
            preview: last.content,
            direction: last.role === "ai" ? "outbound" : "inbound",
            occurred_at: last.ts,
            status: last.status || "",
          });
        }
      }
      for (const c of voiceRes.calls || []) {
        recent.push({
          channel: "voice",
          client_name: c.client_name,
          preview: c.preview || c.endedReason || c.status,
          direction: "outbound",
          occurred_at: c.startedAt,
          status: c.status,
        });
      }
      for (const t of gmailRes.threads || []) {
        recent.push({
          channel: "email",
          client_name: t.client_name,
          preview: t.lastMessagePreview,
          direction: t.lastDirection,
          occurred_at: t.lastMessageAt,
          status: "",
        });
      }
      recent.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

      return { clients, queue, counters, latestRun, recent: recent.slice(0, 8), promises };
    },
    refetchInterval: 30000,
  });
}

function Overview() {
  const { data, isLoading, error } = useOverviewData();
  const clients = data?.clients ?? [];
  const queue = data?.queue ?? [];
  const counters = data?.counters ?? [];
  const latestRun = data?.latestRun;
  const recent = data?.recent ?? [];
  const promises = data?.promises ?? [];

  const outstanding = clients.reduce((sum: number, c: { collection_amount: number }) => sum + Number(c.collection_amount), 0);
  const replies = recent.filter((m) => m.direction === "inbound").length;

  return (
    <AppShell
      title="Collections Overview"
      subtitle={`Daily overdue run · ${latestRun ? shortDate(latestRun.run_date) : "no runs yet"} · live`}
    >
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">Could not load overview data.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total outstanding"
          value={peso(outstanding)}
          hint={`${clients.length} accounts tracked`}
          tone="primary"
        />
        <StatCard label="Recent messages" value={String(recent.length)} hint="Across all channels" />
        <StatCard label="Client replies" value={String(replies)} hint="Inbound conversations" />
        <StatCard
          label="Payment promises"
          value={String(promises.length)}
          hint="Recorded by the AI reply agent"
        />
        <StatCard
          label="Queued today"
          value={String(queue.length)}
          hint={peso(queue.reduce((s: number, q: { collection_amount: number }) => s + Number(q.collection_amount), 0))}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Channel activity" description="Sent today vs. daily provider limit">
            <ul className="divide-y divide-border">
              {CHANNELS.map((ch) => {
                const counter = counters.find((c: { channel: string }) => c.channel === ch.id);
                const pct = counter
                  ? Math.min(100, (counter.sent_count / counter.daily_limit) * 100)
                  : 0;
                return (
                  <li key={ch.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="w-32 shrink-0">
                      <ChannelBadge channel={ch.id} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: ch.colorVar }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {counter?.sent_count ?? 0} sent today of {counter?.daily_limit ?? 0} limit
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Latest communications" description="Newest events pulled from every provider">
            <ul className="divide-y divide-border">
              {recent.map((m, i) => (
                <li key={i} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:flex-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ChannelBadge channel={m.channel} />
                        <span className="text-sm font-semibold">{m.client_name}</span>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {m.direction}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{m.preview}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.status ? <StatusPill status={m.status} /> : null}
                    <span className="text-xs text-muted-foreground">{timeAgo(m.occurred_at)}</span>
                  </div>
                </li>
              ))}
              {!isLoading && recent.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">No activity yet.</li>
              ) : null}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Today's queue" description="From the n8n daily overdue run">
            <ul className="divide-y divide-border">
              {queue.slice(0, 6).map((q: { queue_id: string; client_name: string; queue_status: string; collection_amount: number; due_date: string; preferred_channel: string; fallback_channel: string }) => (
                <li key={q.queue_id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{q.client_name}</span>
                    <StatusPill status={q.queue_status.toLowerCase()} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {peso(q.collection_amount)} · due {shortDate(q.due_date)}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {q.preferred_channel ? (
                      <ChannelBadge channel={q.preferred_channel.toLowerCase()} />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No channel on file</span>
                    )}
                    {q.fallback_channel ? (
                      <>
                        <span className="text-[11px] text-muted-foreground">fallback →</span>
                        <ChannelBadge channel={q.fallback_channel.toLowerCase()} />
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
              {!isLoading && queue.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing queued yet.</li>
              ) : null}
            </ul>
          </Panel>

          <Panel title="Recent payment promises" description="Recorded by the AI reply agent">
            {promises.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                None recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {promises.map(
                  (p: { client_name: string; channel: string; reason: string; promise_date: string }, i: number) => (
                    <li key={i} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{p.client_name}</span>
                        <ChannelBadge channel={p.channel} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reasonLabel(p.reason)} · by {shortDate(p.promise_date)}
                      </p>
                    </li>
                  ),
                )}
              </ul>
            )}
          </Panel>

          {latestRun ? (
            <Panel title="Daily run summary" description={shortDate(latestRun.run_date)}>
              <dl className="grid grid-cols-2 gap-px bg-border">
                {[
                  ["Processed", String(latestRun.total_processed)],
                  ["Outstanding", peso(latestRun.total_outstanding)],
                  ["Viber queued", String(latestRun.viber_queued)],
                  ["Email queued", String(latestRun.email_queued)],
                  ["No contact", `${latestRun.no_contact_count} · ${peso(latestRun.no_contact_amount)}`],
                  ["Email only", `${latestRun.email_only_count} · ${peso(latestRun.email_only_amount)}`],
                ].map(([label, value]) => (
                  <div key={label} className="bg-card px-4 py-3">
                    <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
