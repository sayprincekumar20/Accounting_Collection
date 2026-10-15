import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  LogFilterBar,
  matchesLogFilters,
  sourceLabel,
  useLogFilters,
} from "@/components/collections/LogFilters";
import {
  Panel,
  ChannelBadge,
  StatusPill,
  StatCard,
  RefreshButton,
} from "@/components/collections/Bits";

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
  trigger_source?: string;
  requested_by?: string;
}

const QUEUE_STATUSES = [
  { value: "all", label: "All statuses" },
  { value: "q_PENDING", label: "Pending" },
  { value: "q_WAITING_QUOTA", label: "Waiting on quota" },
  { value: "q_SENT", label: "Sent" },
  { value: "q_FAILED", label: "Failed" },
  { value: "q_HELD", label: "Held (paused)" },
  { value: "q_SUPPRESSED", label: "Suppressed (promise / AR)" },
  { value: "q_SKIPPED_MULTIBRANCH", label: "Skipped: 5+ branches" },
  { value: "q_SKIPPED_SALESPERSON", label: "Skipped: sales person" },
  { value: "q_STALE", label: "Stale (retired)" },
];

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

function useQueue() {
  return useQuery({
    queryKey: ["reminder-queue-list"],
    queryFn: async () => {
      const r = await fetch("/api/reminder-queue-list");
      if (!r.ok) throw new Error("Queue fetch failed");
      const d = await r.json();
      return (d.queue ?? []) as QueueRow[];
    },
    refetchInterval: 14400000, // 4 hours -- see hard-refresh button for on-demand updates
  });
}

function QueuePage() {
  const { data, isLoading, isFetching, error, refetch } = useQueue();
  const queue = data ?? [];
  const sent = queue.filter((q) => q.queue_status.toUpperCase() === "SENT");
  const waiting = queue.filter((q) => q.queue_status.toUpperCase() === "WAITING_QUOTA");
  const skipped = queue.filter((q) => q.queue_status.toUpperCase().startsWith("SKIPPED"));
  const [filters, setFilters, clearFilters] = useLogFilters();
  const statusIsMine = QUEUE_STATUSES.some((o) => o.value === filters.status);
  const wanted = statusIsMine && filters.status !== "all" ? filters.status.slice(2) : "";
  const visible = queue.filter(
    (q) =>
      (!wanted || q.queue_status.toUpperCase() === wanted) &&
      matchesLogFilters(
        {
          name: q.client_name,
          contact: q.contact_person,
          extra: `${q.invoice_numbers} ${q.preferred_channel} ${q.client_id}`,
          lastActivity: q.sent_date || q.attempted_date || q.created_date,
          source: q.trigger_source,
        },
        { ...filters, status: "all" },
      ),
  );
  const toggle = (st: string) => setFilters({ status: filters.status === st ? "all" : st });

  return (
    <AppShell
      title="Reminder Queue"
      subtitle="Built by the n8n daily overdue run · live"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="In this cycle's queue" value={String(queue.length)} tone="primary" />
        <StatCard
          label="Sent"
          value={String(sent.length)}
          onClick={() => toggle("q_SENT")}
          active={filters.status === "q_SENT"}
        />
        <StatCard
          label="Waiting on quota"
          value={String(waiting.length)}
          hint={peso(waiting.reduce((s, q) => s + Number(q.collection_amount), 0))}
          onClick={() => toggle("q_WAITING_QUOTA")}
          active={filters.status === "q_WAITING_QUOTA"}
        />
        <StatCard
          label="Skipped"
          value={String(skipped.length)}
          hint="5+ branches or do-not-contact sales person"
          onClick={() => toggle("q_SKIPPED_MULTIBRANCH")}
          active={filters.status === "q_SKIPPED_MULTIBRANCH"}
        />
      </div>

      <div className="mt-5">
        <LogFilterBar
          filters={filters}
          onChange={setFilters}
          onClear={clearFilters}
          shown={visible.length}
          total={queue.length}
          statusOptions={QUEUE_STATUSES}
          rangeLabel="Any sent date"
          searchPlaceholder="Search client, contact, invoice, channel…"
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
                  <th className="px-4 py-2.5 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((q) => (
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
                    <td className="px-4 py-3 text-xs font-semibold">
                      {q.trigger_source ? sourceLabel(q.trigger_source, q.requested_by) : "—"}
                    </td>
                  </tr>
                ))}
                {!isLoading && visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No queue entries match.
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
