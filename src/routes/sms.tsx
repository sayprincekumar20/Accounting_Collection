import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard, ChannelBadge, StatusPill, ClientTime } from "@/components/collections/Bits";
import { clientsQuery, messagesQuery, peso, shortDate } from "@/lib/collections";

export const Route = createFileRoute("/sms")({
  head: () => ({
    meta: [
      { title: "SMS Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Real SMS conversations for every overdue client — organized by client and phone number, with delivery status and timestamps, synced live from Telerivet.",
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

  const smsMessages = messages
    .filter((m) => m.channel === "sms")
    .slice()
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

  const threadIds = Array.from(new Set(smsMessages.map((m) => m.client_id))).filter(
    (id): id is string => !!id,
  );

  const [active, setActive] = useState<string | null>(null);
  const activeClient = clients.find((c) => c.id === active);
  const thread = smsMessages
    .filter((m) => m.client_id === active)
    .slice()
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const outboundCount = smsMessages.filter((m) => m.direction === "outbound").length;
  const inboundCount = smsMessages.filter((m) => m.direction === "inbound").length;

  return (
    <AppShell title="SMS Inbox" subtitle="Delivered through Telerivet · relayed by n8n">
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Threads" value={String(threadIds.length)} tone="primary" />
        <StatCard label="Outbound" value={String(outboundCount)} />
        <StatCard label="Replies received" value={String(inboundCount)} />
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

      <section className="surface-card mt-5 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em]">Threads</h2>
          <span className="text-xs text-muted-foreground">{threadIds.length} clients</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Phone</th>
                <th className="px-4 py-2.5 font-semibold">Last message</th>
                <th className="px-4 py-2.5 font-semibold">Direction</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {threadIds.map((id) => {
                const c = clients.find((x) => x.id === id);
                const last = smsMessages.find((m) => m.client_id === id);
                if (!last) return null;
                return (
                  <tr
                    key={id}
                    onClick={() => setActive(id)}
                    className={`cursor-pointer transition-colors ${
                      id === active ? "bg-secondary" : "hover:bg-muted"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="block truncate font-semibold">
                        {c?.client_name ?? "Unknown"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c?.phone ?? "—"}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <span className="block truncate text-muted-foreground">{last.body ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold">
                        {last.direction === "inbound" ? (
                          <ArrowDownLeft className="h-3 w-3" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3" />
                        )}
                        {last.direction === "inbound" ? "Inbound" : "Outbound"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={last.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      <ClientTime value={last.occurred_at} />
                    </td>
                  </tr>
                );
              })}
              {threadIds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No SMS activity logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {active ? (
        <>
          <div
            onClick={() => setActive(null)}
            className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-[2px] animate-in fade-in"
          />
          <aside
            role="dialog"
            aria-label="SMS thread detail"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200"
          >
            <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
              <div>
                <h2 className="text-base font-bold">{activeClient?.client_name ?? "Unknown"}</h2>
                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Phone:</span>{" "}
                    {activeClient?.phone ?? "—"}
                  </div>
                  {activeClient ? (
                    <div>
                      <span className="font-semibold text-foreground">Outstanding:</span>{" "}
                      {peso(activeClient.collection_amount)} · due{" "}
                      {shortDate(activeClient.due_date)}
                    </div>
                  ) : null}
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ChannelBadge channel="sms" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                {activeClient ? (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: activeClient.id }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    View client
                  </Link>
                ) : null}
                <button
                  onClick={() => setActive(null)}
                  aria-label="Close thread detail"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="p-5">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Conversation
              </h3>
              <ol className="space-y-4">
                {thread.map((m) => {
                  const outbound = m.direction === "outbound";
                  return (
                    <li
                      key={m.id}
                      className={`flex flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}
                    >
                      <div className="text-[11px] text-muted-foreground">
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
                      <StatusPill status={m.status} />
                    </li>
                  );
                })}
                {thread.length === 0 ? (
                  <li className="text-sm text-muted-foreground">Nothing to show.</li>
                ) : null}
              </ol>
            </div>
          </aside>
        </>
      ) : null}
    </AppShell>
  );
}
