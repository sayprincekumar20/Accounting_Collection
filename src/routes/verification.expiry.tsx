import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { VerificationTabs } from "@/components/verification/VerificationTabs";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, RefreshButton, StatCard } from "@/components/collections/Bits";
import { RequestDialog } from "@/components/verification/RequestDialog";
import { day, dvRequest, EXPIRY_TONE, when, type ExpiryItem } from "@/lib/dv";

export const Route = createFileRoute("/verification/expiry")({
  head: () => ({ meta: [{ title: "Document Expiry | Document Verification" }] }),
  component: ExpiryPage,
});

const CARDS = [
  { id: "Expired", hint: "Reminded every week until renewed", tone: "primary" as const },
  { id: "Expiring in 7 days", hint: "Collect the renewal now", tone: "default" as const },
  { id: "Expiring in 30 days", hint: "First reminder sent", tone: "default" as const },
  { id: "Valid", hint: "More than 30 days left", tone: "default" as const },
];

function ExpiryPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["dv-expiry"],
    queryFn: () =>
      dvRequest<{ today: string; counts: Record<string, number>; items: ExpiryItem[] }>(
        "/api/dv-expiry",
      ),
    refetchInterval: 300000,
  });
  const items = data?.items ?? [];
  const [filter, setFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [renew, setRenew] = useState<ExpiryItem | null>(null);
  const visible = items.filter(
    (i) =>
      (filter === "ALL" || i.state === filter) &&
      (!q ||
        `${i.account_name} ${i.customer_number ?? ""} ${i.document} ${i.account_owner ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );

  return (
    <AppShell
      title="Document Verification"
      subtitle="Expiry dates of the documents on each verified account (from its latest verification)"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <VerificationTabs active="expiry" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <StatCard
            key={c.id}
            label={c.id}
            value={String(data?.counts?.[c.id] ?? 0)}
            hint={c.hint}
            tone={c.tone}
            onClick={() => setFilter(filter === c.id ? "ALL" : c.id)}
            active={filter === c.id}
          />
        ))}
      </div>

      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <label className="sr-only" htmlFor="dv-expiry-search">
          Search documents
        </label>
        <input
          id="dv-expiry-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search account, customer number, document, account owner…"
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
          title="Documents"
          description={`${visible.length} shown · soonest expiry first · reminders go to the Account Owner`}
        >
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">
              Could not load the expiry dates: {(error as Error).message}
            </p>
          ) : null}
          {!isLoading && !error && visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No documents here.</p>
          ) : null}
          {visible.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Account</th>
                    <th className="px-4 py-2.5 font-semibold">Document</th>
                    <th className="px-4 py-2.5 font-semibold">Valid until</th>
                    <th className="px-4 py-2.5 font-semibold">Days left</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Reminders</th>
                    <th className="px-4 py-2.5 font-semibold">Verified</th>
                    <th className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((i) => (
                    <tr key={`${i.account_id}-${i.document_type}`} className="hover:bg-muted/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{i.account_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {i.customer_number || "—"}
                          {i.account_owner ? ` · ${i.account_owner}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{i.document}</p>
                        <p className="break-all text-xs text-muted-foreground">{i.file || ""}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{day(i.valid_until)}</td>
                      <td
                        className={`px-4 py-3 font-semibold tabular-nums ${i.days_left !== null && i.days_left < 0 ? "text-destructive" : ""}`}
                      >
                        {i.days_left === null
                          ? "—"
                          : i.days_left < 0
                            ? `${-i.days_left} overdue`
                            : i.days_left}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${EXPIRY_TONE[i.state] ?? "bg-muted"}`}
                        >
                          {i.state}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {i.reminders_sent ? (
                          <>
                            <p>{i.reminders_sent} sent</p>
                            <p className="text-muted-foreground">last {when(i.last_reminder_at)}</p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">none yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <p>{when(i.verified_at)}</p>
                        {i.review_id ? (
                          <Link
                            to="/verification/$reviewId"
                            params={{ reviewId: i.review_id }}
                            className="font-semibold text-primary hover:underline"
                          >
                            {i.review_number}
                          </Link>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {i.state !== "No expiry date" ? (
                          <button
                            type="button"
                            onClick={() => setRenew(i)}
                            className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                          >
                            Request renewal
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
        {renew ? (
          <RequestDialog
            accountId={renew.account_id}
            documents={[renew.document_type]}
            title={`Request renewal: ${renew.document}`}
            onClose={() => setRenew(null)}
          />
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">
          Renewed a document? Attach it to the Account in Zoho CRM and click Verify Account; the new
          date replaces the old one. New files are also picked up by the weekly check.
        </p>
      </div>
    </AppShell>
  );
}
