import { SkeletonBlock } from "@/components/collections/Skeleton";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel } from "@/components/collections/Bits";

// AR management summary on the Overview page (data: /api/insights).
interface Insights {
  today: string;
  aging: { bucket: string; amount: number; promised: number; invoices: number }[];
  pipeline: {
    this_week: { clients: number; amount: number };
    next_week: { clients: number; amount: number };
    kept: number;
    broken: number;
  };
  escalations: {
    type: string;
    open: number;
    in_progress: number;
    done: number;
    avg_open_hours: number;
  }[];
  funnel: { step: string; clients: number }[];
  top_overdue: {
    client_id: string;
    client_name: string;
    overdue: number;
    total: number;
    oldest_days: number;
    promised: boolean;
  }[];
}
const peso = (v: number) =>
  "PHP " + Number(v || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
const short = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1000
      ? `${Math.round(v / 1000)}K`
      : String(Math.round(v));

export function ArInsights() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["insights"],
    queryFn: async () => {
      const r = await fetch("/api/insights");
      if (!r.ok) throw new Error("Fetch failed");
      return (await r.json()) as Insights;
    },
    refetchInterval: 300000,
  });
  if (isLoading)
    return (
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-72" />
      </div>
    );
  if (error || !data)
    return <p className="mt-5 text-sm text-destructive">Could not load the AR summary.</p>;
  const chart = data.aging.map((a) => ({
    bucket: a.bucket,
    Promised: a.promised,
    "Not promised": Math.max(0, a.amount - a.promised),
    invoices: a.invoices,
  }));
  const keptRate =
    data.pipeline.kept + data.pipeline.broken
      ? Math.round((data.pipeline.kept / (data.pipeline.kept + data.pipeline.broken)) * 100)
      : null;
  const maxFunnel = Math.max(1, ...data.funnel.map((f) => f.clients));
  const escTotalOpen = data.escalations.reduce((t, e) => t + e.open + e.in_progress, 0);
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Panel
        title="Aging"
        description="Open balance by days past due · green = covered by a payment promise"
      >
        <div className="h-64 px-2 pb-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={short} tick={{ fontSize: 11 }} width={48} />
              <Tooltip formatter={(v: number) => peso(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Not promised" stackId="a" fill="hsl(0 72% 42%)" />
              <Bar dataKey="Promised" stackId="a" fill="hsl(142 55% 38%)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel
        title="Promise pipeline"
        description="Payment commitments from clients (latest promise per client)"
      >
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">
              Due this week
            </p>
            <p className="mt-1 text-xl font-bold">{peso(data.pipeline.this_week.amount)}</p>
            <p className="text-xs text-muted-foreground">
              {data.pipeline.this_week.clients} client(s)
            </p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">
              Due next week
            </p>
            <p className="mt-1 text-xl font-bold">{peso(data.pipeline.next_week.amount)}</p>
            <p className="text-xs text-muted-foreground">
              {data.pipeline.next_week.clients} client(s)
            </p>
          </div>
          <a href="/promises" className="rounded-xl border border-border p-3 hover:bg-muted">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">
              Kept (last 30 days)
            </p>
            <p className="mt-1 text-xl font-bold">{keptRate == null ? "–" : `${keptRate}%`}</p>
            <p className="text-xs text-muted-foreground">
              {data.pipeline.kept} kept ·{" "}
              <span className="text-destructive">{data.pipeline.broken} broken</span>
            </p>
          </a>
        </div>
      </Panel>

      <Panel
        title="Escalations by type"
        description={`${escTotalOpen} open or in progress · average time open`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Open</th>
                <th className="px-3 py-2 text-right">In progress</th>
                <th className="px-3 py-2 text-right">Done</th>
                <th className="px-3 py-2 text-right">Avg. open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.escalations
                .filter((e) => e.open + e.in_progress + e.done > 0)
                .map((e) => (
                  <tr key={e.type}>
                    <td className="px-3 py-2">
                      <a href="/escalations?tab=worklist" className="font-semibold hover:underline">
                        {e.type}
                      </a>
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${e.open ? "font-semibold text-destructive" : ""}`}
                    >
                      {e.open}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.in_progress}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {e.done}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${e.avg_open_hours >= 48 ? "font-semibold text-destructive" : ""}`}
                    >
                      {e.open + e.in_progress
                        ? e.avg_open_hours >= 48
                          ? `${Math.round(e.avg_open_hours / 24)} days`
                          : `${e.avg_open_hours} h`
                        : "–"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Contact funnel (this cycle)"
        description="Since Wednesday 00:00 · clients at each step"
      >
        <div className="space-y-2 p-4">
          {data.funnel.map((f) => (
            <div key={f.step} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{f.step}</span>
              <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                <div
                  className="flex h-full items-center rounded-md bg-primary/80 px-2 text-xs font-semibold text-primary-foreground"
                  style={{ width: `${Math.max(6, (f.clients / maxFunnel) * 100)}%` }}
                >
                  {f.clients}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="xl:col-span-2">
        <Panel title="Top 10 overdue clients" description="Click a client to open its page">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2 text-right">Overdue</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Oldest overdue</th>
                  <th className="px-3 py-2">Promise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.top_overdue.map((c) => (
                  <tr key={c.client_id} className="hover:bg-muted/50">
                    <td className="px-3 py-2">
                      <a
                        href={`/clients/${encodeURIComponent(c.client_id)}`}
                        className="font-semibold hover:underline"
                      >
                        {c.client_name}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-destructive">
                      {peso(c.overdue)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{peso(c.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.oldest_days ? `${c.oldest_days} days` : "–"}
                    </td>
                    <td className="px-3 py-2">
                      {c.promised ? (
                        <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success">
                          Promised
                        </span>
                      ) : (
                        "–"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
