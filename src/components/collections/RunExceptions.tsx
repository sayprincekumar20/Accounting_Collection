import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/collections/Bits";

// 'No contact on file' and 'Email only, no mobile' from the latest weekly run (moved from Reports to
// Contacts to Fix): the clients whose contact details must be completed in Zoho.
interface RunLog {
  run_date: string;
  run_timestamp: string;
  no_contact_details: {
    parent_name?: string;
    branch_name?: string;
    invoices?: string;
    amount?: number;
  }[];
  email_only_details: { client_name?: string; email?: string; amount?: number }[];
  recorded: { no_contact: boolean; email_only: boolean };
}
const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (v: string) =>
  v
    ? new Date(v).toLocaleString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

function ExceptionList({
  rows,
  recorded,
}: {
  rows: { main: string; sub: string; amount: number }[];
  recorded: boolean;
}) {
  if (!recorded)
    return <p className="px-4 py-6 text-sm text-muted-foreground">Not recorded for this run.</p>;
  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="max-h-96 divide-y divide-border overflow-y-auto">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{r.main}</p>
            {r.sub ? <p className="truncate text-[11px] text-muted-foreground">{r.sub}</p> : null}
          </div>
          <span className="shrink-0 text-sm tabular-nums">{peso(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

export function RunExceptions() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["daily-run-logs"],
    queryFn: async () => {
      const r = await fetch("/api/daily-run-logs");
      if (!r.ok) throw new Error("Run logs fetch failed");
      return ((await r.json()).runs ?? []) as RunLog[];
    },
  });
  const run = (data ?? [])[0];
  if (isLoading) return <div className="mt-5 h-40 animate-pulse rounded-2xl bg-muted" />;
  if (!run) return null;
  const s = q.trim().toLowerCase();
  const noContact = (run.no_contact_details ?? []).filter(
    (b) => !s || `${b.parent_name} ${b.branch_name} ${b.invoices}`.toLowerCase().includes(s),
  );
  const emailOnly = (run.email_only_details ?? []).filter(
    (c) => !s || `${c.client_name} ${c.email}`.toLowerCase().includes(s),
  );
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          From the weekly run of{" "}
          <span className="font-semibold text-foreground">
            {when(run.run_timestamp || run.run_date)}
          </span>
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search these lists…"
          className="h-9 w-64 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title={`No contact on file (${run.recorded?.no_contact ? noContact.length : "–"})`}
          description="Overdue branches with no phone and no email: not reachable automatically."
        >
          <ExceptionList
            recorded={!!run.recorded?.no_contact}
            rows={noContact.map((b) => ({
              main: b.branch_name || b.parent_name || "",
              sub: [
                b.parent_name !== b.branch_name ? b.parent_name : "",
                b.invoices ? `Invoices ${b.invoices}` : "",
              ]
                .filter(Boolean)
                .join(" · "),
              amount: b.amount || 0,
            }))}
          />
        </Panel>
        <Panel
          title={`Email only, no mobile (${run.recorded?.email_only ? emailOnly.length : "–"})`}
          description="Reminder emailed, but no phone number for a call."
        >
          <ExceptionList
            recorded={!!run.recorded?.email_only}
            rows={emailOnly.map((c) => ({
              main: c.client_name || "",
              sub: c.email || "",
              amount: c.amount || 0,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}
