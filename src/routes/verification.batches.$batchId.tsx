import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, RefreshButton } from "@/components/collections/Bits";
import { RequestDialog } from "@/components/verification/RequestDialog";
import { VerificationTabs } from "@/components/verification/VerificationTabs";
import {
  BATCH_TONE,
  dvRequest,
  when,
  type BatchItemRow,
  type BatchReport,
  type BatchSummary,
} from "@/lib/dv";

export const Route = createFileRoute("/verification/batches/$batchId")({
  head: () => ({ meta: [{ title: "Batch | Document Verification" }] }),
  component: BatchPage,
});

const STATE_TONE: Record<string, string> = {
  Waiting: "bg-muted text-muted-foreground",
  Checking: "bg-primary/10 text-primary",
  Done: "bg-success/12 text-success",
  "No documents": "bg-warning/15 text-warning",
  Failed: "bg-destructive/12 text-destructive",
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`mr-1 mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {children}
    </span>
  );
}

function Results({ i }: { i: BatchItemRow }) {
  const r = i.result;
  if (!r) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div>
      {r.ok ? <Chip tone="bg-success/12 text-success">OK</Chip> : null}
      {r.no_documents ? (
        <Chip tone="bg-destructive/12 text-destructive">No documents on the Account</Chip>
      ) : null}
      {r.wrong.length ? (
        <Chip tone="bg-destructive/12 text-destructive">
          Another business: {r.wrong.join(", ")}
        </Chip>
      ) : null}
      {r.expired.length ? (
        <Chip tone="bg-destructive/12 text-destructive">Expired: {r.expired.join(", ")}</Chip>
      ) : null}
      {r.missing.length ? (
        <Chip tone="bg-warning/15 text-warning">Missing: {r.missing.join(", ")}</Chip>
      ) : null}
      {r.expiring.length ? (
        <Chip tone="bg-warning/10 text-warning">Expiring: {r.expiring.join(", ")}</Chip>
      ) : null}
      {r.unreadable ? <Chip tone="bg-muted text-foreground">{r.unreadable} unreadable</Chip> : null}
      {r.needs_decision ? <Chip tone="bg-primary/10 text-primary">Needs a decision</Chip> : null}
      <p className="text-[11px] text-muted-foreground">{r.documents} document(s) read</p>
    </div>
  );
}

function BatchPage() {
  const { batchId } = Route.useParams();
  const {
    data: b,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dv-batch", batchId],
    queryFn: () => dvRequest<BatchReport>(`/api/dv-batches/${batchId}`),
    refetchInterval: (q) =>
      (q.state.data as BatchReport | undefined)?.status === "Completed" ? false : 15000,
  });
  const [note, setNote] = useState<string | null>(null);
  const [requestFor, setRequestFor] = useState<BatchItemRow[]>([]);

  async function act(path: string, label: string) {
    setNote(null);
    try {
      await dvRequest(`/api/dv-batches/${path}`, { method: "POST" });
      setNote(label);
      await refetch();
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  const toRequest = (b?.items ?? []).filter((i) => i.result?.request);
  const current = requestFor[0];
  const pct = b && b.size ? Math.round((b.done / b.size) * 100) : 0;
  const s: Partial<BatchSummary> = b?.summary ?? {};
  const btn =
    "rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted disabled:opacity-50";

  return (
    <AppShell
      title={b ? `Batch ${b.number} · ${b.channel}` : "Batch"}
      subtitle={
        b
          ? `${b.size} Active accounts · started ${when(b.created_at)} by ${b.created_by || "—"}${b.completed_at ? ` · completed ${when(b.completed_at)}` : ""}`
          : ""
      }
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <VerificationTabs active="batches" />
      <p className="mb-3 text-sm">
        <Link to="/verification/batches" className="font-semibold text-primary hover:underline">
          ← All batches
        </Link>
      </p>
      {error ? <p className="text-sm text-destructive">{(error as Error).message}</p> : null}
      {b ? (
        <>
          <div className="surface-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BATCH_TONE[b.status] ?? ""}`}
                >
                  {b.status}
                </span>
                <span className="text-sm tabular-nums">
                  {b.done} / {b.size} checked
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {b.status === "Running" ? (
                  <button
                    type="button"
                    className={btn}
                    onClick={() => act(`${b.id}/pause`, "Paused.")}
                  >
                    Pause
                  </button>
                ) : null}
                {b.status === "Paused" ? (
                  <button
                    type="button"
                    className={btn}
                    onClick={() => act(`${b.id}/resume`, "Resumed.")}
                  >
                    Resume
                  </button>
                ) : null}
                {b.status !== "Completed" ? (
                  <button
                    type="button"
                    className={btn}
                    onClick={() =>
                      act(`${b.id}/complete`, "Completed; unchecked accounts stay left.")
                    }
                  >
                    Complete now
                  </button>
                ) : null}
                <button
                  type="button"
                  className={btn}
                  disabled={!toRequest.length}
                  onClick={() => setRequestFor(toRequest)}
                >
                  Request all ({toRequest.length})
                </button>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {Object.entries(b.counts)
                .map(([k, v]) => `${k} ${v}`)
                .join(" · ")}
            </p>
            {note ? <p className="mt-2 text-sm">{note}</p> : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["OK", s.ok],
              ["No documents", s.no_documents],
              ["Missing documents", s.missing],
              ["Expired documents", s.expired],
              ["Expiring in 30 days", s.expiring],
              ["Unreadable / another business", (s.unreadable ?? 0) + (s.wrong ?? 0)],
              ["Need a decision", s.needs_decision],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded-lg border border-border bg-card p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {label}
                </p>
                <p className="text-xl font-semibold tabular-nums">{v ?? 0}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Spot-checks: {s.spot_checked ?? 0} done, {s.spot_correct ?? 0} correct. Open an account
            and use Correct / Not correct.
          </p>

          <div className="mt-4">
            <Panel
              title="Accounts"
              description="Open each account to review it; ← Previous / Next → on the review page"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-4 py-2.5 font-semibold">#</th>
                      <th className="px-4 py-2.5 font-semibold">Account</th>
                      <th className="px-4 py-2.5 font-semibold">Status</th>
                      <th className="px-4 py-2.5 font-semibold">Result</th>
                      <th className="px-4 py-2.5 font-semibold">Spot-check</th>
                      <th className="px-4 py-2.5 font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {b.items.map((i) => (
                      <tr key={i.id} className="align-top hover:bg-muted/60">
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {i.position}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{i.account_name || i.account_id}</p>
                          <p className="text-xs text-muted-foreground">
                            {i.customer_number || "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Chip tone={STATE_TONE[i.status] ?? "bg-muted"}>{i.status}</Chip>
                        </td>
                        <td className="px-4 py-3">
                          <Results i={i} />
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {i.spot_check ? (
                            <>
                              <p
                                className={
                                  i.spot_check === "Correct" ? "text-success" : "text-destructive"
                                }
                              >
                                {i.spot_check}
                              </p>
                              {i.spot_note ? (
                                <p className="text-muted-foreground">{i.spot_note}</p>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            {i.review_id ? (
                              <Link
                                to="/verification/$reviewId"
                                params={{ reviewId: i.review_id }}
                                className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-center text-xs font-semibold hover:bg-muted"
                              >
                                Open
                              </Link>
                            ) : null}
                            {i.result?.request ? (
                              <button
                                type="button"
                                onClick={() => setRequestFor([i])}
                                className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                              >
                                Request documents
                              </button>
                            ) : null}
                            {i.status === "Failed" || i.status === "No documents" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  act(`${b.id}/items/${i.id}/retry`, "Will be checked again.")
                                }
                                className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                              >
                                Check again
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      ) : null}

      {current ? (
        <RequestDialog
          key={current.id}
          accountId={current.account_id}
          title={`Request documents${requestFor.length > 1 ? ` (${requestFor.length} left)` : ""}`}
          onClose={() => setRequestFor(requestFor.slice(1))}
        />
      ) : null}
    </AppShell>
  );
}
