import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, ChannelBadge, StatusPill, StatCard } from "@/components/collections/Bits";
import { peso, queueQuery, shortDate } from "@/lib/collections";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "Reminder Queue | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Pending, sent and failed overdue reminders with preferred channel and fallback channel per client.",
      },
      { property: "og:title", content: "Reminder Queue | Rare Global Food Collections" },
      {
        property: "og:description",
        content: "Preferred and fallback channel status for every queued overdue reminder.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(queueQuery),
  component: QueuePage,
});

function QueuePage() {
  const { data: queue } = useSuspenseQuery(queueQuery);
  const sent = queue.filter((q) => q.queue_status === "sent");
  const blocked = queue.filter((q) => q.queue_status === "no_contact");

  return (
    <AppShell title="Reminder Queue" subtitle="Built by the n8n daily overdue run">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Queued today" value={String(queue.length)} tone="primary" />
        <StatCard label="Sent" value={String(sent.length)} />
        <StatCard
          label="Blocked — no contact"
          value={String(blocked.length)}
          hint={peso(blocked.reduce((s, q) => s + Number(q.collection_amount), 0))}
        />
      </div>

      <div className="mt-5">
        <Panel title="Queue entries">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">Preferred</th>
                  <th className="px-4 py-2.5 font-semibold">Fallback</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">Due</th>
                  <th className="px-4 py-2.5 font-semibold">Sent</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {queue.map((q) => (
                  <tr key={q.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3 font-semibold">{q.client_name}</td>
                    <td className="px-4 py-3">
                      {q.preferred_channel === "none" ? (
                        <span className="text-xs text-muted-foreground">None available</span>
                      ) : (
                        <ChannelBadge channel={q.preferred_channel} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {q.fallback_channel ? (
                        <ChannelBadge channel={q.fallback_channel} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {peso(q.collection_amount)}
                    </td>
                    <td className="px-4 py-3">{shortDate(q.due_date)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {q.sent_date ? shortDate(q.sent_date) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={q.queue_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
