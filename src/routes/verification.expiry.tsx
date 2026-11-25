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
  const [renew, setRenew] = useState<{ account: string; docs: ExpiryItem[] } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const visible = items.filter(
    (i) =>
      (filter === "ALL" || i.state === filter) &&
      (!q ||
        `${i.account_name} ${i.customer_number ?? ""} ${i.document} ${i.account_owner ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  // one group per customer, soonest expiry first (items come sorted by days left)
  const groups: { id: string; docs: ExpiryItem[] }[] = [];
  for (const it of items) {
    let g = groups.find((x) => x.id === it.account_id);
    if (!g) groups.push((g = { id: it.account_id, docs: [] }));
    g.docs.push(it);
  }
  const shown = groups.filter((g) => g.docs.some((d) => visible.includes(d)));
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
          title="Customers"
          description={`${shown.length} customers · ${visible.length} documents · soonest expiry first · click a customer to see its documents`}
        >
          <div className="flex justify-end gap-2 px-4 pt-3">
            <button
              type="button"
              onClick={() => setOpen(new Set(shown.map((g) => g.id)))}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setOpen(new Set())}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
            >
              Collapse all
            </button>
          </div>
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">
              Could not load the expiry dates: {(error as Error).message}
            </p>
          ) : null}
          {!isLoading && !error && shown.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No documents here.</p>
          ) : null}
          <div className="divide-y divide-border">
            {shown.map((g) => (
              <CustomerGroup
                key={g.id}
                docs={g.docs}
                open={open.has(g.id)}
                onToggle={() => toggle(g.id)}
                onRenew={(docs) => setRenew({ account: g.id, docs })}
              />
            ))}
          </div>
        </Panel>
        {renew ? (
          <RequestDialog
            accountId={renew.account}
            documents={renew.docs.map((d) => d.document_type)}
            title={`Request renewal: ${renew.docs.map((d) => d.document).join(", ")}`}
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

const RANK: Record<string, number> = {
  Expired: 0,
  "Expiring in 7 days": 1,
  "Expiring in 30 days": 2,
  Valid: 3,
  "No expiry date": 4,
};

const HIGHLIGHT: Record<string, string> = {
  Expired: "border-l-4 border-l-destructive bg-destructive/5",
  "Expiring in 7 days": "border-l-4 border-l-warning bg-warning/10",
  "Expiring in 30 days": "border-l-4 border-l-warning bg-warning/5",
  Valid: "border-l-4 border-l-success bg-success/5",
};

/** One customer: a summary row (highlighted when it has documents with an expiry date) that
 *  expands to its documents. */
function CustomerGroup({
  docs,
  open,
  onToggle,
  onRenew,
}: {
  docs: ExpiryItem[];
  open: boolean;
  onToggle: () => void;
  onRenew: (docs: ExpiryItem[]) => void;
}) {
  const first = docs[0]!;
  const worst = [...docs].sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9))[0]!;
  const dated = docs.filter((d) => d.state !== "No expiry date");
  const soonest = dated[0];
  const reminders = docs.reduce((n, d) => n + d.reminders_sent, 0);
  return (
    <div className={dated.length ? (HIGHLIGHT[worst.state] ?? "") : ""}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-[260px] flex-1 items-start gap-2 text-left"
        >
          <span className="mt-0.5 text-xs text-muted-foreground">{open ? "▼" : "▶"}</span>
          <span>
            <span className="block font-semibold">{first.account_name}</span>
            <span className="block text-xs text-muted-foreground">
              {first.customer_number || "—"}
              {first.account_owner ? ` · ${first.account_owner}` : ""}
              {first.channel ? ` · ${first.channel}` : ""}
            </span>
          </span>
        </button>
        <span className="w-28 text-xs text-muted-foreground">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </span>
        <span className="w-40 text-sm">
          {soonest ? (
            <>
              {day(soonest.valid_until)}
              <span
                className={`ml-2 font-semibold tabular-nums ${soonest.days_left !== null && soonest.days_left < 0 ? "text-destructive" : ""}`}
              >
                {soonest.days_left === null
                  ? ""
                  : soonest.days_left < 0
                    ? `${-soonest.days_left} overdue`
                    : `${soonest.days_left} days`}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
        <span
          className={`w-40 whitespace-nowrap rounded-full px-2.5 py-0.5 text-center text-[11px] font-semibold ${EXPIRY_TONE[worst.state] ?? "bg-muted"}`}
        >
          {worst.state}
        </span>
        <span className="w-24 text-xs text-muted-foreground">
          {reminders ? `${reminders} reminder${reminders === 1 ? "" : "s"}` : "none yet"}
        </span>
        <span className="w-32 text-xs">
          {first.review_id ? (
            <Link
              to="/verification/$reviewId"
              params={{ reviewId: first.review_id }}
              className="font-semibold text-primary hover:underline"
            >
              {first.review_number}
            </Link>
          ) : null}
          <span className="block text-muted-foreground">{when(first.verified_at)}</span>
        </span>
        <span className="w-36 text-right">
          {dated.length ? (
            <button
              type="button"
              onClick={() => onRenew(dated)}
              className="whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
            >
              Request renewal
            </button>
          ) : null}
        </span>
      </div>
      {open ? (
        <div className="overflow-x-auto px-4 pb-3 pl-10">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 font-semibold">Document</th>
                <th className="py-1.5 font-semibold">Valid until</th>
                <th className="py-1.5 font-semibold">Days left</th>
                <th className="py-1.5 font-semibold">Status</th>
                <th className="py-1.5 font-semibold">Reminders</th>
                <th className="py-1.5 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map((d) => (
                <tr key={d.document_type}>
                  <td className="py-2">
                    <p>{d.document}</p>
                    <p className="break-all text-xs text-muted-foreground">{d.file || ""}</p>
                  </td>
                  <td className="py-2 whitespace-nowrap">{day(d.valid_until)}</td>
                  <td
                    className={`py-2 font-semibold tabular-nums ${d.days_left !== null && d.days_left < 0 ? "text-destructive" : ""}`}
                  >
                    {d.days_left === null
                      ? "—"
                      : d.days_left < 0
                        ? `${-d.days_left} overdue`
                        : d.days_left}
                  </td>
                  <td className="py-2">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${EXPIRY_TONE[d.state] ?? "bg-muted"}`}
                    >
                      {d.state}
                    </span>
                  </td>
                  <td className="py-2 text-xs">
                    {d.reminders_sent ? (
                      <>
                        {d.reminders_sent} sent
                        <span className="block text-muted-foreground">
                          last {when(d.last_reminder_at)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">none yet</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {d.state !== "No expiry date" ? (
                      <button
                        type="button"
                        onClick={() => onRenew([d])}
                        className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
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
    </div>
  );
}
