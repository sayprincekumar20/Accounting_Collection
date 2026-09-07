import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, ChannelBadge, StatusPill } from "@/components/collections/Bits";
import { clientsQuery, messagesQuery, peso, shortDate } from "@/lib/collections";

export const Route = createFileRoute("/sms")({
  head: () => ({
    meta: [
      { title: "SMS Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Real SMS conversations for every overdue client — organized by client and phone number, with delivery status and timestamps.",
      },
      { property: "og:title", content: "SMS Inbox | Rare Global Food Collections" },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(clientsQuery),
      context.queryClient.ensureQueryData(messagesQuery),
    ]);
  },
  component: SmsInbox,
});

function SmsInbox() {
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const { data: messages } = useSuspenseQuery(messagesQuery);

  const smsMessages = messages.filter((m) => m.channel === "sms");
  const threadIds = Array.from(new Set(smsMessages.map((m) => m.client_id))).filter(
    (id): id is string => !!id,
  );
  const [active, setActive] = useState<string | null>(null);
  const activeId = active && threadIds.includes(active) ? active : (threadIds[0] ?? null);

  const thread = smsMessages
    .filter((m) => m.client_id === activeId)
    .slice()
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  const activeClient = clients.find((c) => c.id === activeId);

  return (
    <AppShell title="SMS Inbox" subtitle="Delivered through Telerivet · relayed by n8n">
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Conversations" value={String(threadIds.length)} tone="primary" />
        <StatCard
          label="Outbound"
          value={String(smsMessages.filter((m) => m.direction === "outbound").length)}
        />
        <StatCard
          label="Replies received"
          value={String(smsMessages.filter((m) => m.direction === "inbound").length)}
        />
        <StatCard
          label="Promises to pay"
          value={String(smsMessages.filter((m) => m.promise_recorded).length)}
          hint="Client committed to a payment date"
        />
        <StatCard
          label="AR notified"
          value={String(smsMessages.filter((m) => m.notified_ar).length)}
          hint="Overdue reminder escalated to AR"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <Panel title="Conversations" description={`${threadIds.length} clients`}>
          <ul className="divide-y divide-border">
            {threadIds.map((id) => {
              const c = clients.find((x) => x.id === id);
              const last = smsMessages.find((m) => m.client_id === id);
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
                        {shortDate(last?.occurred_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c?.phone ?? "—"}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {last?.body ?? "—"}
                    </p>
                  </button>
                </li>
              );
            })}
            {threadIds.length === 0 ? (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No SMS activity logged yet.
              </li>
            ) : null}
          </ul>
        </Panel>

        <Panel
          title={activeClient?.client_name ?? "No conversation selected"}
          description={
            activeClient
              ? `${activeClient.phone ?? "—"} · ${peso(activeClient.collection_amount)} outstanding · due ${shortDate(activeClient.due_date)}`
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
                    <ChannelBadge channel="sms" />
                    {shortDate(m.occurred_at)}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm ${
                      outbound
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-border bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                  {/* Delivery/status per message — required by SMS spec */}
                  <StatusPill status={m.status} />
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
