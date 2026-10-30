import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, RefreshButton, StatCard } from "@/components/collections/Bits";
import {
  dvRequest,
  isOpen,
  RECOMMENDATION_TONE,
  recommendationLabel,
  STATUS_TONE,
  when,
  type ReviewSummary,
} from "@/lib/dv";

export const Route = createFileRoute("/verification/")({
  head: () => ({ meta: [{ title: "Document Verification | Rare Global Food Collections" }] }),
  component: VerificationListPage,
});

const FILTERS = [
  { id: "OPEN", label: "Open", hint: "Waiting for a decision" },
  { id: "Applied", label: "Applied", hint: "Approved and written to Zoho" },
  { id: "Waiting for Documents", label: "Waiting for documents", hint: "Customer must send more" },
  { id: "Rejected", label: "Rejected", hint: "Closed without changes" },
] as const;

function VerificationListPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["dv-reviews"],
    queryFn: async () =>
      (await dvRequest<{ items: ReviewSummary[] }>("/api/dv-reviews?limit=200")).items ?? [],
    refetchInterval: 120000,
  });
  const items = data ?? [];
  const [filter, setFilter] = useState<string>("OPEN");
  const [q, setQ] = useState("");
  const matches = (r: ReviewSummary, f: string) =>
    f === "OPEN" ? isOpen(r.status) : f === "ALL" ? true : r.status === f;
  const visible = items.filter(
    (r) =>
      matches(r, filter) &&
      (!q ||
        `${r.number} ${r.account_name ?? ""} ${r.customer_number ?? ""} ${r.requested_by ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );

  return (
    <AppShell
      title="Document Verification"
      subtitle="Accounts checked with the Verify Account button in Zoho CRM that need a person's decision"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FILTERS.map((f) => (
          <StatCard
            key={f.id}
            label={f.label}
            value={String(items.filter((r) => matches(r, f.id)).length)}
            hint={f.hint}
            tone={f.id === "OPEN" ? "primary" : "default"}
            onClick={() => setFilter(filter === f.id ? "ALL" : f.id)}
            active={filter === f.id}
          />
        ))}
      </div>

      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <label className="sr-only" htmlFor="dv-search">
          Search reviews
        </label>
        <input
          id="dv-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search account, customer number, DV number, sales rep…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-background px-2.5 text-sm"
        />
        {filter !== "ALL" ? (
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
          >
            Show all
          </button>
        ) : null}
      </div>

      <div className="mt-5">
        <Panel
          title="Reviews"
          description={`${visible.length} shown · newest first · opens the review to approve, edit or reject`}
        >
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">
              Could not load reviews: {(error as Error).message}
            </p>
          ) : null}
          {!isLoading && !error && visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No reviews here.</p>
          ) : null}
          {visible.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Review</th>
                    <th className="px-4 py-2.5 font-semibold">Account</th>
                    <th className="px-4 py-2.5 font-semibold">Recommendation</th>
                    <th className="px-4 py-2.5 font-semibold">Checks met</th>
                    <th className="px-4 py-2.5 font-semibold">To decide</th>
                    <th className="px-4 py-2.5 font-semibold">Requested</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">
                        <Link
                          to="/verification/$reviewId"
                          params={{ reviewId: r.id }}
                          className="text-primary hover:underline"
                        >
                          {r.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/verification/$reviewId"
                          params={{ reviewId: r.id }}
                          className="font-semibold text-primary hover:underline"
                        >
                          {r.account_name || r.account_id}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {r.customer_number || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${RECOMMENDATION_TONE[r.recommendation] ?? "bg-muted"}`}
                        >
                          {recommendationLabel(r.recommendation)}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{r.checks_met ?? "—"}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {isOpen(r.status)
                          ? `${r.rows_to_decide} row${r.rows_to_decide === 1 ? "" : "s"}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p>{when(r.created_at)}</p>
                        <p className="text-xs text-muted-foreground">{r.requested_by || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[r.status] ?? "bg-muted"}`}
                        >
                          {r.status}
                        </span>
                        {r.reviewer ? (
                          <p className="mt-1 text-xs text-muted-foreground">by {r.reviewer}</p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      </div>
    </AppShell>
  );
}
