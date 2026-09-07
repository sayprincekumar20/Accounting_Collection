import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard } from "@/components/collections/Bits";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Daily Run Reports | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Daily overdue run history: processed accounts, outstanding totals, queued channels, no-contact and email-only exceptions, synced live from n8n.",
      },
      { property: "og:title", content: "Daily Run Reports | Rare Global Food Collections" },
    ],
  }),
  component: ReportsPage,
});

interface RunLog {
  run_date: string;
  run_timestamp: string;
  total_processed: number;
  total_outstanding: number;
  email_queued: number;
  viber_queued: number;
  no_contact_count: number;
  no_contact_amount: number;
  email_only_count: number;
  email_only_amount: number;
  skipped_cooldown: number;
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

function useRunLogs() {
  return useQuery({
    queryKey: ["daily-run-logs"],
    queryFn: async () => {
      const r = await fetch("/api/daily-run-logs");
      if (!r.ok) throw new Error("Run logs fetch failed");
      const d = await r.json();
      return (d.runs ?? []) as RunLog[];
    },
    refetchInterval: 60000,
  });
}

function ReportsPage() {
  const { data, isLoading, error } = useRunLogs();
  const runs = data ?? [];
  const latest = runs[0];
  const max = Math.max(...runs.map((r) => r.total_processed), 1);

  return (
    <AppShell title="Reports" subtitle="Daily overdue run history and exception lists · live">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Runs logged" value={String(runs.length)} tone="primary" />
        <StatCard
          label="No contact (latest run)"
          value={String(latest?.no_contact_count ?? 0)}
          hint={peso(latest?.no_contact_amount ?? 0)}
        />
        <StatCard
          label="Email only (latest run)"
          value={String(latest?.email_only_count ?? 0)}
          hint={peso(latest?.email_only_amount ?? 0)}
        />
      </div>

      <div className="mt-5 space-y-5">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {error ? <p className="text-sm text-destructive">Could not load run logs.</p> : null}

        <Panel title="Processed per run" description="Recent daily runs">
          <div className="flex h-40 items-end gap-2 px-4 py-4">
            {runs
              .slice()
              .reverse()
              .map((r) => (
                <div key={r.run_date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-primary"
                    style={{ height: `${(r.total_processed / max) * 100}%` }}
                    title={`${r.total_processed} processed`}
                  />
                  <span className="truncate text-[10px] text-muted-foreground">
                    {new Date(r.run_date).getDate()}
                  </span>
                </div>
              ))}
          </div>
        </Panel>

        <Panel title="Daily run log">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Run date</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Processed</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Email</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Viber</th>
                  <th className="px-4 py-2.5 text-right font-semibold">No contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.run_date} className="hover:bg-muted/60">
                    <td className="px-4 py-3 font-semibold">{shortDate(r.run_date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.total_processed}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {peso(r.total_outstanding)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.email_queued}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.viber_queued}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.no_contact_count} · {peso(r.no_contact_amount)}
                    </td>
                  </tr>
                ))}
                {!isLoading && runs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No runs logged yet.
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
