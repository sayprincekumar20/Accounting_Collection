import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Panel, ChannelBadge, StatusPill, StatCard, TimeAgo } from "@/components/collections/Bits";
import {
  CHANNELS,
  clientsQuery,
  daysOverdue,
  messagesQuery,
  peso,
  queueQuery,
  shortDate,
} from "@/lib/collections";

export const Route = createFileRoute("/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "Client Conversation Timeline | Rare Global Food" },
      {
        name: "description",
        content:
          "Full communication history for a single account across WhatsApp, Viber, SMS, Email and voice calls.",
      },
      { property: "og:title", content: "Client Conversation Timeline | Rare Global Food" },
      {
        property: "og:description",
        content: "Every reminder and reply for one account, in one timeline.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(clientsQuery),
      context.queryClient.ensureQueryData(messagesQuery),
      context.queryClient.ensureQueryData(queueQuery),
    ]);
  },
  component: ClientDetail,
});

function ClientDetail() {
  const { clientId } = Route.useParams();
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const { data: messages } = useSuspenseQuery(messagesQuery);
  const { data: queue } = useSuspenseQuery(queueQuery);
  const [filter, setFilter] = useState<string>("all");

  const client = clients.find((c) => c.id === clientId);
  if (!client) throw notFound();

  const thread = messages
    .filter((m) => m.client_id === client.id)
    .filter((m) => filter === "all" || m.channel === filter)
    .slice()
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  const clientQueue = queue.filter((q) => q.client_id === client.id);

  return (
    <AppShell
      title={client.client_name}
      subtitle={`${client.parent_name ?? "Direct account"} · Account ${client.external_id ?? "—"}`}
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
        <StatCard label="Messages" value={String(messages.filter((m) => m.client_id === client.id).length)} hint="All channels" />
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
            action={
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
              >
                <option value="all">All channels</option>
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            }
          >
            <ol className="space-y-4 p-4">
              {thread.length === 0 ? (
                <li className="text-sm text-muted-foreground">No messages on this channel yet.</li>
              ) : null}
              {thread.map((m) => {
                const outbound = m.direction === "outbound";
                return (
                  <li
                    key={m.id}
                    className={`flex flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-center gap-2">
                      <ChannelBadge channel={m.channel} />
                      <span className="text-[11px] text-muted-foreground">
                        {m.provider ?? "—"} · {shortDate(m.occurred_at)} · <TimeAgo value={m.occurred_at} />
                      </span>
                    </div>
                    <div
                      className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 text-sm ${
                        outbound
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-border bg-muted"
                      }`}
                    >
                      {m.subject ? (
                        <p className="mb-1 text-xs font-bold uppercase tracking-wide opacity-80">
                          {m.subject}
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      {m.transcript ? (
                        <p className="mt-2 border-t border-current/20 pt-2 text-xs opacity-90">
                          Transcript: {m.transcript}
                        </p>
                      ) : null}
                      {m.duration_seconds != null ? (
                        <p className="mt-1 text-xs opacity-80">
                          Call duration: {Math.floor(m.duration_seconds / 60)}m{" "}
                          {m.duration_seconds % 60}s
                          {m.agent_name ? ` · ${m.agent_name}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill status={m.status} />
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
                ["Email", client.email ?? "Not on file"],
                ["Phone", client.phone ?? "Not on file"],
                ["Branches", client.branches ?? "—"],
                ["AR owner", client.ar_owner ?? "Unassigned"],
                ["Source", client.source ?? "—"],
                ["Invoices", client.invoice_numbers ?? "—"],
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

          {clientQueue.length ? (
            <Panel title="Queue entries">
              <ul className="divide-y divide-border text-sm">
                {clientQueue.map((q) => (
                  <li key={q.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <ChannelBadge channel={q.preferred_channel} />
                      <StatusPill status={q.queue_status} />
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
