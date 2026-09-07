import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Panel, StatusPill, StatCard, ChannelBadge, TimeAgo } from "@/components/collections/Bits";
import {
  channelMeta,
  clientsQuery,
  messagesQuery,
  peso,
  shortDate,
} from "@/lib/collections";
import { setMessageFlags } from "@/lib/messages.functions";

export const Route = createFileRoute("/inbox/$channel")({
  head: ({ params }) => {
    const label = channelMeta(params.channel).label;
    return {
      meta: [
        { title: `${label} Inbox | Rare Global Food Collections` },
        {
          name: "description",
          content: `Every ${label} reminder and client reply logged for Rare Global Food overdue collections.`,
        },
        { property: "og:title", content: `${label} Inbox | Rare Global Food Collections` },
        {
          property: "og:description",
          content: `Threaded ${label} conversations between the AR team and overdue clients.`,
        },
      ],
    };
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(clientsQuery),
      context.queryClient.ensureQueryData(messagesQuery),
    ]);
  },
  component: ChannelInbox,
});

function ChannelInbox() {
  const { channel } = Route.useParams();
  const meta = channelMeta(channel);
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const { data: messages } = useSuspenseQuery(messagesQuery);
  const queryClient = useQueryClient();
  const updateFlags = useServerFn(setMessageFlags);
  const flagMutation = useMutation({
    mutationFn: (input: { id: string; promise_recorded?: boolean; notified_ar?: boolean }) =>
      updateFlags({ data: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages"] }),
  });

  const channelMessages = messages.filter((m) => m.channel === channel);
  const threadIds = Array.from(new Set(channelMessages.map((m) => m.client_id)));
  const [active, setActive] = useState<string | null>(threadIds[0] ?? null);
  const activeId = active && threadIds.includes(active) ? active : (threadIds[0] ?? null);

  const thread = channelMessages
    .filter((m) => m.client_id === activeId)
    .slice()
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  const activeClient = clients.find((c) => c.id === activeId);

  return (
    <AppShell
      title={`${meta.label} Inbox`}
      subtitle={`Delivered through ${meta.provider} · relayed by n8n`}
    >
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Conversations" value={String(threadIds.length)} tone="primary" />
        <StatCard
          label="Outbound"
          value={String(channelMessages.filter((m) => m.direction === "outbound").length)}
        />
        <StatCard
          label="Replies received"
          value={String(channelMessages.filter((m) => m.direction === "inbound").length)}
        />
        <StatCard
          label="Promises to pay"
          value={String(channelMessages.filter((m) => m.promise_recorded).length)}
          hint="Client committed to a payment date"
        />
        <StatCard
          label="AR notified"
          value={String(channelMessages.filter((m) => m.notified_ar).length)}
          hint="Overdue reminder escalated to AR"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <Panel title="Threads" description={`${threadIds.length} clients`}>
          <ul className="divide-y divide-border">
            {threadIds.map((id) => {
              const c = clients.find((x) => x.id === id);
              const last = channelMessages.find((m) => m.client_id === id);
              return (
                <li key={id}>
                  <button
                    onClick={() => setActive(id)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      id === activeId ? "bg-secondary" : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {c?.client_name ?? "Unknown"}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {last ? <TimeAgo value={last.occurred_at} /> : ""}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {last?.subject ?? last?.body ?? "—"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {channelMessages.some((m) => m.client_id === id && m.promise_recorded) ? (
                        <FlagTag kind="promise" />
                      ) : null}
                      {channelMessages.some((m) => m.client_id === id && m.notified_ar) ? (
                        <FlagTag kind="ar" />
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
            {threadIds.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No {meta.label} activity logged yet.
              </li>
            ) : null}
          </ul>
        </Panel>

        <Panel
          title={activeClient?.client_name ?? "No conversation selected"}
          description={
            activeClient
              ? `${peso(activeClient.collection_amount)} outstanding · due ${shortDate(activeClient.due_date)}`
              : undefined
          }
          action={
            activeClient ? (
              <Link
                to="/clients/$clientId"
                params={{ clientId: activeClient.id }}
                className="text-xs font-semibold text-primary hover:underline"
              >
                View client
              </Link>
            ) : null
          }
        >
          <ol className="space-y-4 p-4">
            {thread.map((m) => {
              const outbound = m.direction === "outbound";
              return (
                <li
                  key={m.id}
                  className={`flex flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <ChannelBadge channel={m.channel} />
                    {m.provider} · {shortDate(m.occurred_at)}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm ${
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
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={m.status} />
                    {m.promise_recorded ? <FlagTag kind="promise" /> : null}
                    {m.notified_ar ? <FlagTag kind="ar" /> : null}
                    <button
                      type="button"
                      disabled={flagMutation.isPending}
                      onClick={() =>
                        flagMutation.mutate({ id: m.id, promise_recorded: !m.promise_recorded })
                      }
                      className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {m.promise_recorded ? "Clear promise" : "Mark promise to pay"}
                    </button>
                    <button
                      type="button"
                      disabled={flagMutation.isPending}
                      onClick={() => flagMutation.mutate({ id: m.id, notified_ar: !m.notified_ar })}
                      className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {m.notified_ar ? "Clear AR notice" : "Mark AR notified"}
                    </button>
                  </div>
                </li>
              );
            })}
            {thread.length === 0 ? (
              <li className="text-sm text-muted-foreground">Nothing to show.</li>
            ) : null}
          </ol>
        </Panel>
      </div>
    </AppShell>
  );
}

function FlagTag({ kind }: { kind: "promise" | "ar" }) {
  const promise = kind === "promise";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{
        color: promise ? "var(--whatsapp)" : "var(--primary)",
        backgroundColor: `color-mix(in oklab, ${promise ? "var(--whatsapp)" : "var(--primary)"} 14%, transparent)`,
      }}
    >
      {promise ? "Promise to pay" : "AR notified"}
    </span>
  );
}
