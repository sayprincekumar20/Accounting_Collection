import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { StatCard, Panel, ChannelBadge, StatusPill, TimeAgo } from "@/components/collections/Bits";
import {
  CHANNELS,
  clientsQuery,
  countersQuery,
  messagesQuery,
  peso,
  queueQuery,
  runLogsQuery,
  shortDate,
} from "@/lib/collections";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Collections Overview | Rare Global Food Communications Hub" },
      {
        name: "description",
        content:
          "Live overdue-reminder overview across WhatsApp, Viber, SMS, Email and Voice for Rare Global Food accounts receivable.",
      },
      { property: "og:title", content: "Collections Overview | Rare Global Food" },
      {
        property: "og:description",
        content:
          "Track every overdue reminder sent through WhatsApp, Viber, SMS, Email and AI voice agents in one dashboard.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(clientsQuery),
      context.queryClient.ensureQueryData(messagesQuery),
      context.queryClient.ensureQueryData(queueQuery),
      context.queryClient.ensureQueryData(runLogsQuery),
      context.queryClient.ensureQueryData(countersQuery),
    ]);
  },
  component: Overview,
});

function Overview() {
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const { data: messages } = useSuspenseQuery(messagesQuery);
  const { data: queue } = useSuspenseQuery(queueQuery);
  const { data: runs } = useSuspenseQuery(runLogsQuery);
  const { data: counters } = useSuspenseQuery(countersQuery);

  const outstanding = clients.reduce((sum, c) => sum + Number(c.collection_amount), 0);
  const latestRun = runs[0];
  const replies = messages.filter((m) => m.direction === "inbound").length;
  const noContact = clients.filter((c) => c.status === "no_contact");

  return (
    <AppShell
      title="Collections Overview"
      subtitle={`Daily overdue run · ${latestRun ? shortDate(latestRun.run_date) : "no runs yet"}`}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total outstanding"
          value={peso(outstanding)}
          hint={`${clients.length} accounts tracked`}
          tone="primary"
        />
        <StatCard
          label="Messages sent"
          value={String(messages.filter((m) => m.direction === "outbound").length)}
          hint="Across all channels"
        />
        <StatCard label="Client replies" value={String(replies)} hint="Inbound conversations" />
        <StatCard
          label="No contact on file"
          value={String(noContact.length)}
          hint={peso(noContact.reduce((s, c) => s + Number(c.collection_amount), 0))}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-5">
          <Panel title="Channel activity" description="Sent today vs. daily provider limit">
            <ul className="divide-y divide-border">
              {CHANNELS.map((ch) => {
                const counter = counters.find((c) => c.channel === ch.id);
                const total = messages.filter((m) => m.channel === ch.id).length;
                const pct = counter
                  ? Math.min(100, (counter.sent_count / counter.daily_limit) * 100)
                  : 0;
                return (
                  <li key={ch.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="w-32 shrink-0">
                      <ChannelBadge channel={ch.id} />
                      <p className="mt-1 text-[11px] text-muted-foreground">{ch.provider}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, backgroundColor: ch.colorVar }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {counter?.sent_count ?? 0} sent today of {counter?.daily_limit ?? 0} limit ·{" "}
                        {total} logged messages
                      </p>
                    </div>
                    <Link
                      to="/inbox/$channel"
                      params={{ channel: ch.id }}
                      className="shrink-0 text-xs font-semibold text-primary hover:underline"
                    >
                      Open inbox
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel
            title="Latest communications"
            description="Newest events pulled from every provider"
          >
            <ul className="divide-y divide-border">
              {messages.slice(0, 8).map((m) => {
                const client = clients.find((c) => c.id === m.client_id);
                return (
                  <li key={m.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:flex-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ChannelBadge channel={m.channel} />
                          <span className="text-sm font-semibold">
                            {client?.client_name ?? "Unknown client"}
                          </span>
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {m.direction}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                          {m.subject ?? m.body ?? "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={m.status} />
                      <span className="text-xs text-muted-foreground">
                        <TimeAgo value={m.occurred_at} />
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Today's queue" description="From the n8n daily overdue run">
            <ul className="divide-y divide-border">
              {queue.slice(0, 6).map((q) => (
                <li key={q.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{q.client_name}</span>
                    <StatusPill status={q.queue_status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {peso(q.collection_amount)} · due {shortDate(q.due_date)}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {q.preferred_channel !== "none" ? (
                      <ChannelBadge channel={q.preferred_channel} />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No channel on file</span>
                    )}
                    {q.fallback_channel ? (
                      <>
                        <span className="text-[11px] text-muted-foreground">fallback →</span>
                        <ChannelBadge channel={q.fallback_channel} />
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
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
                    <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </dt>
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
