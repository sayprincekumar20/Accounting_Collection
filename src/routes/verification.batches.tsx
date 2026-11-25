import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, RefreshButton } from "@/components/collections/Bits";
import { VerificationTabs } from "@/components/verification/VerificationTabs";
import { BATCH_TONE, dvRequest, when, type BatchHead, type BatchReport } from "@/lib/dv";

export const Route = createFileRoute("/verification/batches")({
  head: () => ({ meta: [{ title: "Batch Check | Document Verification" }] }),
  component: BatchesPage,
});

type Overview = { channel: string; active: number; checked: number; left: number };

function BatchesPage() {
  const navigate = useNavigate();
  const channels = useQuery({
    queryKey: ["dv-batch-channels"],
    queryFn: () => dvRequest<{ channels: string[] }>("/api/dv-batches/channels"),
  });
  const list = useQuery({
    queryKey: ["dv-batches"],
    queryFn: () => dvRequest<{ items: BatchHead[] }>("/api/dv-batches"),
    refetchInterval: 15000,
  });
  const [channel, setChannel] = useState("");
  const [size, setSize] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ["dv-batch-overview", channel],
    enabled: !!channel,
    queryFn: () =>
      dvRequest<Overview>(`/api/dv-batches/overview?channel=${encodeURIComponent(channel)}`),
  });
  const o = overview.data;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const b = await dvRequest<BatchReport>("/api/dv-batches", {
        method: "POST",
        body: JSON.stringify({ channel, size }),
      });
      await navigate({ to: "/verification/batches/$batchId", params: { batchId: b.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = "h-9 rounded-lg border border-border bg-background px-2.5 text-sm";
  return (
    <AppShell
      title="Document Verification"
      subtitle="Check the documents of Active accounts, one channel at a time (no status changes, no emails)"
      actions={<RefreshButton isFetching={list.isFetching} onRefresh={() => list.refetch()} />}
    >
      <VerificationTabs active="batches" />

      <Panel title="New batch" description="Active accounts not checked in the last 12 months">
        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
          <label className="text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">Channel</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className={`${field} min-w-[260px]`}
            >
              <option value="">Choose a channel…</option>
              {(channels.data?.channels ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs font-semibold text-muted-foreground">Batch size</span>
            <input
              type="number"
              min={1}
              max={200}
              value={size}
              onChange={(e) => setSize(Number(e.target.value) || 20)}
              className={`${field} w-24`}
            />
          </label>
          <button
            type="button"
            disabled={!channel || busy || !o || o.left === 0}
            onClick={start}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Starting…" : "Start batch"}
          </button>
        </div>
        {channel ? (
          <div className="grid grid-cols-3 gap-3 px-4 pb-4 text-sm sm:max-w-xl">
            {overview.isLoading ? (
              <p className="col-span-3 text-muted-foreground">Counting Active accounts…</p>
            ) : o ? (
              <>
                <Count label="Active accounts" value={o.active} />
                <Count label="Checked" value={o.checked} />
                <Count label="Left to check" value={o.left} strong />
              </>
            ) : null}
          </div>
        ) : null}
        {overview.error ? (
          <p className="px-4 pb-4 text-sm text-destructive">{(overview.error as Error).message}</p>
        ) : null}
        {error ? <p className="px-4 pb-4 text-sm text-destructive">{error}</p> : null}
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          About 1-3 minutes per account, 2 at a time. Each file is read once (cached). Results go to
          Document expiry; accounts that need a decision to Reviews; missing or expired documents
          are requested from the batch report.
        </p>
      </Panel>

      <div className="mt-5">
        <Panel title="Batches" description="Newest first">
          {!list.data?.items.length ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No batches yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Batch</th>
                    <th className="px-4 py-2.5 font-semibold">Channel</th>
                    <th className="px-4 py-2.5 font-semibold">Progress</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.data.items.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3 font-semibold">
                        <Link
                          to="/verification/batches/$batchId"
                          params={{ batchId: b.id }}
                          className="text-primary hover:underline"
                        >
                          Batch {b.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">{b.channel}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {b.done} / {b.size}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${BATCH_TONE[b.status] ?? "bg-muted"}`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {when(b.created_at)} · {b.created_by || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function Count({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-xl tabular-nums ${strong ? "font-bold text-primary" : "font-semibold"}`}>
        {value}
      </p>
    </div>
  );
}
