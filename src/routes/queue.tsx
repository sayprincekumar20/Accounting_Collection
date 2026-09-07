import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, ChannelBadge, StatusPill, StatCard } from "@/components/collections/Bits";

export const Route = createFileRoute("/queue")({
  head: () => ({
    meta: [
      { title: "Reminder Queue | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Pending, sent and failed overdue reminders with preferred channel and fallback channel per client, synced live from n8n.",
      },
      { property: "og:title", content: "Reminder Queue | Rare Global Food Collections" },
    ],
  }),
  component: QueuePage,
});

interface QueueRow {
  queue_id: string;
  client_id: string;
  client_name: string;
  contact_person: string;
  preferred_channel: string;
  queue_status: string;
  fallback_channel: string;
  fallback_status: string;
  collection_amount: number;
  due_date: string;
  invoice_numbers: string;
  created_date: string;
  attempted_date: string;
  sent_date: string;
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

function useQueue() {
  return useQuery({
    queryKey: ["reminder-queue-list"],
    queryFn: async () => {
      const r = await fetch("/api/reminder-queue-list");
      if (!r.ok) throw new Error("Queue fetch failed");
      const d = await r.json();
      return (d.queue ?? []) as QueueRow[];
    },
    refetchInterval: 30000,
  });
}

function QueuePage() {
  const { data, isLoading, error } = useQueue();
  const queue = data ?? [];
  const sent = queue.filter((q) => q.queue_status.toUpperCase() === "SENT");
  const waiting = queue.filter((q) => q.queue_status.toUpperCase() === "WAITING_QUOTA");

  return (
    <AppShell title="Reminder Queue" subtitle="Built by the n8n daily overdue run · live">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Queued today" value={String(queue.length)} tone="primary" />
        <StatCard label="Sent" value={String(sent.length)} />
        <StatCard
          label="Waiting on quota"
          value={String(waiting.length)}
          hint={peso(waiting.reduce((s, q) => s + Number(q.collection_amount), 0))}
        />
      </div>

      <div className="mt-5">
        <Panel title="Queue entries">
          {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? <p className="p-4 text-sm text-destructive">Could not load the queue.</p> : null}
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
                  <tr key={q.queue_id} className="hover:bg-muted/60">
                    <td className="px-4 py-3 font-semibold">{q.client_name}</td>
                    <td className="px-4 py-3">
                      {!q.preferred_channel ? (
                        <span className="text-xs text-muted-foreground">None available</span>
                      ) : (
                        <ChannelBadge channel={q.preferred_channel.toLowerCase()} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {q.fallback_channel ? (
                        <ChannelBadge channel={q.fallback_channel.toLowerCase()} />
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
                      <StatusPill status={q.queue_status.toLowerCase()} />
                    </td>
                  </tr>
                ))}
                {!isLoading && queue.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No queue entries yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
