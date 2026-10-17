import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { downloadCsv } from "@/lib/csv";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";
import { LogFilterBar, useLogFilters } from "@/components/collections/LogFilters";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Daily Run Reports | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Weekly run history: what each run queued and skipped, and what actually happened (sent, calls, replies, promises, escalations).",
      },
      { property: "og:title", content: "Daily Run Reports | Rare Global Food Collections" },
    ],
  }),
  component: ReportsPage,
});

interface Results {
  emails_sent: number;
  sms_sent: number;
  whatsapp_sent: number;
  calls_placed: number;
  calls_failed: number;
  retries: number;
  cliq_call_sends: number;
  client_replies: number;
  clients_replied: number;
  ai_replies: number;
  promises: number;
  escalations: number;
  not_reached?: number;
}
interface RunLog {
  run_date: string;
  run_timestamp: string;
  total_processed: number;
  total_outstanding: number;
  email_queued: number;
  sms_queued: number;
  viber_queued: number;
  voice_queued: number;
  skipped_cooldown: number;
  skipped_multibranch: number;
  skipped_salesperson: number;
  no_contact_count: number;
  no_contact_amount: number;
  no_contact_details: {
    parent_name?: string;
    branch_name?: string;
    amount?: number;
    invoices?: string;
  }[];
  email_only_count: number;
  email_only_amount: number;
  email_only_details: { client_name?: string; email?: string; amount?: number }[];
  recorded: { no_contact: boolean; email_only: boolean; sms: boolean; voice: boolean };
  results: Results;
}

function peso(v: number) {
  return (
    "PHP " +
    Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
function runLabel(v: string) {
  const d = new Date(`${v}T00:00:00+08:00`);
  return isNaN(d.getTime())
    ? v
    : d.toLocaleDateString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
function inRange(runDate: string, range: string) {
  if (range === "all") return true;
  const t = new Date(`${runDate}T00:00:00+08:00`).getTime();
  const now = Date.now();
  if (range === "today") return now - t < 86400000 && now >= t;
  return now - t <= (range === "7d" ? 7 : 30) * 86400000;
}

interface CallReport {
  id: string;
  as_of: string;
  created_at: string;
  requested_by: string;
  source: string;
  client_count: number;
  invoice_count: number;
  total: number;
  overdue: number;
  current: number;
  sheet_url: string;
  xlsx_url: string;
}

function useCallReports() {
  return useQuery({
    queryKey: ["call-reports"],
    queryFn: async () => {
      const r = await fetch("/api/call-reports");
      if (!r.ok) throw new Error("Reports fetch failed");
      const d = await r.json();
      return (d.reports ?? []) as CallReport[];
    },
    refetchInterval: 14400000,
  });
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
    refetchInterval: 14400000, // 4 hours -- see the refresh button for on-demand updates
  });
}

const notRecorded = (
  <span className="text-muted-foreground" title="Not recorded by this run (added later)">
    —
  </span>
);

function ReportsPage() {
  const { data, isLoading, isFetching, error, refetch } = useRunLogs();
  const { data: callReports, refetch: refetchReports } = useCallReports();
  const [filters, setFilters, clearFilters] = useLogFilters();
  const all = data ?? [];
  const runs = all.filter((r) => inRange(r.run_date, filters.range));
  const [selected, setSelected] = useState<string | null>(null);
  const current = runs.find((r) => r.run_date === selected) || runs[0];
  const q = filters.q.trim().toLowerCase();
  const noContact = (current?.no_contact_details ?? []).filter(
    (b) => !q || `${b.parent_name} ${b.branch_name} ${b.invoices}`.toLowerCase().includes(q),
  );
  const emailOnly = (current?.email_only_details ?? []).filter(
    (c) => !q || `${c.client_name} ${c.email}`.toLowerCase().includes(q),
  );
  const res = current?.results;

  return (
    <AppShell
      title="Reports"
      subtitle="Weekly runs: what was queued, skipped, and what actually happened · live"
      actions={
        <RefreshButton
          isFetching={isFetching}
          onRefresh={() => {
            refetch();
            refetchReports();
          }}
        />
      }
    >
      <div className="mb-5">
        <Panel
          title="AR reports (from /call runs)"
          description="Built after every /call run: AS OF date, TOTAL, overdue and current, every open invoice with aging, remarks, promise and escalation. Open in Google Sheets or download as Excel (sign in with your @rareglobalfood.com Google account)."
        >
          {(callReports ?? []).length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No AR reports yet. One is created after each /call run.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2.5 font-semibold">As of</th>
                    <th className="px-3 py-2.5 font-semibold">Requested by</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Clients</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Invoices</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Overdue</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Current</th>
                    <th className="px-3 py-2.5 font-semibold">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {(callReports ?? []).slice(0, 20).map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold">
                        {runLabel(r.as_of)}
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {r.created_at
                            ? new Date(r.created_at).toLocaleTimeString("en-PH", {
                                hour: "numeric",
                                minute: "2-digit",
                              })
                            : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{r.requested_by || "—"}</td>
                      <td className="px-3 py-2.5 text-right">{r.client_count}</td>
                      <td className="px-3 py-2.5 text-right">{r.invoice_count}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">{peso(r.total)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {peso(r.overdue)}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {peso(r.current)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <a
                          href={r.sheet_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-primary hover:underline"
                        >
                          Open
                        </a>
                        <span className="mx-2 text-muted-foreground">·</span>
                        <a
                          href={r.xlsx_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-primary hover:underline"
                        >
                          Download (Excel)
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <LogFilterBar
        filters={filters}
        onChange={setFilters}
        onClear={clearFilters}
        shown={runs.length}
        total={all.length}
        hideStatus
        hideSource
        rangeLabel="Any run date"
        searchPlaceholder="Search the exception lists (client, branch, email, invoice)…"
      />

      {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="mt-4 text-sm text-destructive">Could not load run logs.</p> : null}

      {current ? (
        <>
          <h2 className="mt-6 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Run of {runLabel(current.run_date)}
            {current.run_timestamp
              ? ` · started ${new Date(current.run_timestamp).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </h2>
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Clients processed"
              value={String(current.total_processed)}
              hint={peso(current.total_outstanding) + " outstanding"}
              tone="primary"
            />
            <StatCard
              label="Queued to contact"
              value={String(current.email_queued + current.sms_queued + current.viber_queued)}
              hint={`${current.email_queued} email · ${current.recorded.sms ? current.sms_queued : "–"} SMS · ${current.recorded.voice ? current.voice_queued : "–"} calls`}
            />
            <StatCard
              label="Skipped"
              value={String(
                current.skipped_cooldown +
                  current.skipped_multibranch +
                  current.skipped_salesperson,
              )}
              hint={`${current.skipped_multibranch} 5+ branches · ${current.skipped_salesperson} sales person · ${current.skipped_cooldown} cooldown`}
            />
            <StatCard
              label="Not reachable"
              value={current.recorded.no_contact ? String(current.no_contact_count) : "–"}
              hint={
                current.recorded.no_contact
                  ? `no phone/email · ${peso(current.no_contact_amount)}`
                  : "not recorded for this run"
              }
            />
          </div>

          {res ? (
            <div className="mt-5">
              <Panel
                title="What happened in this cycle"
                description="Live from the logs, from this run until the next one (Wed to Fri)."
              >
                <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["Emails sent", res.emails_sent],
                    ["SMS sent", res.sms_sent],
                    [
                      "Calls placed",
                      res.calls_placed,
                      res.calls_failed ? `${res.calls_failed} failed` : "",
                    ],
                    ["Client replies", res.client_replies, `${res.clients_replied} clients`],
                    ["Promises to pay", res.promises],
                    ["Escalated to AR", res.escalations, "needs AR action"],
                  ].map(([label, value, hint]) => (
                    <div key={String(label)} className="bg-card px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-1 text-xl font-bold tabular-nums">{String(value)}</p>
                      {hint ? (
                        <p className="text-[11px] text-muted-foreground">{String(hint)}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="px-4 py-2 text-[11px] text-muted-foreground">
                  {res.not_reached ?? 0} clients not reached by phone (no more retries) ·{" "}
                  {res.ai_replies} AI replies · {res.retries} same-day call retries ·{" "}
                  {res.cliq_call_sends} sends/calls from /call
                </p>
              </Panel>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mt-5">
        <Panel
          title="Daily run log"
          description="Every recorded run. Click a run to see its details above."
          action={
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  "daily-run-log",
                  [
                    "Run date",
                    "Clients",
                    "Outstanding",
                    "Email queued",
                    "SMS queued",
                    "Calls queued",
                    "Skipped 5+ branch",
                    "Skipped sales person",
                    "Skipped cooldown",
                    "No contact",
                    "No contact amount",
                    "Email only",
                    "Email only amount",
                    "Emails sent",
                    "SMS sent",
                    "Calls placed",
                    "Calls failed",
                    "Client replies",
                    "Promises",
                    "Escalated",
                    "Not reached",
                  ],
                  runs.map((r) => [
                    r.run_date,
                    r.total_processed,
                    r.total_outstanding,
                    r.email_queued,
                    r.sms_queued,
                    r.voice_queued,
                    r.skipped_multibranch,
                    r.skipped_salesperson,
                    r.skipped_cooldown,
                    r.no_contact_count,
                    r.no_contact_amount,
                    r.email_only_count,
                    r.email_only_amount,
                    r.results.emails_sent,
                    r.results.sms_sent,
                    r.results.calls_placed,
                    r.results.calls_failed,
                    r.results.client_replies,
                    r.results.promises,
                    r.results.escalations,
                    r.results.not_reached ?? 0,
                  ]),
                )
              }
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
            >
              Export CSV
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Run date</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Clients</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Email q.</th>
                  <th className="px-3 py-2.5 text-right font-semibold">SMS q.</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Calls q.</th>
                  <th className="px-3 py-2.5 text-right font-semibold">5+ branch</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Sales person</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Cooldown</th>
                  <th className="px-3 py-2.5 text-right font-semibold">No contact</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Email only</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Sent</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Calls</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Replies</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Promises</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Escalated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr
                    key={r.run_date}
                    onClick={() => setSelected(r.run_date)}
                    className={`cursor-pointer tabular-nums ${r.run_date === current?.run_date ? "bg-secondary" : "hover:bg-muted/60"}`}
                  >
                    <td className="px-3 py-3 font-semibold whitespace-nowrap">
                      {runLabel(r.run_date)}
                    </td>
                    <td className="px-3 py-3 text-right">{r.total_processed}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {peso(r.total_outstanding)}
                    </td>
                    <td className="px-3 py-3 text-right">{r.email_queued}</td>
                    <td className="px-3 py-3 text-right">
                      {r.recorded.sms ? r.sms_queued : notRecorded}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {r.recorded.voice ? r.voice_queued : notRecorded}
                    </td>
                    <td className="px-3 py-3 text-right">{r.skipped_multibranch}</td>
                    <td className="px-3 py-3 text-right">{r.skipped_salesperson}</td>
                    <td className="px-3 py-3 text-right">{r.skipped_cooldown}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {r.recorded.no_contact
                        ? `${r.no_contact_count} · ${peso(r.no_contact_amount)}`
                        : notRecorded}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {r.recorded.email_only
                        ? `${r.email_only_count} · ${peso(r.email_only_amount)}`
                        : notRecorded}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {r.results.emails_sent + r.results.sms_sent + r.results.whatsapp_sent}
                    </td>
                    <td className="px-3 py-3 text-right">{r.results.calls_placed}</td>
                    <td className="px-3 py-3 text-right">{r.results.client_replies}</td>
                    <td className="px-3 py-3 text-right">{r.results.promises}</td>
                    <td className="px-3 py-3 text-right">{r.results.escalations}</td>
                  </tr>
                ))}
                {!isLoading && runs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={16}
                      className="px-4 py-8 text-center text-sm text-muted-foreground"
                    >
                      No runs in this period.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[11px] text-muted-foreground">
            "q." = queued by the run. Sent, Calls, Replies, Promises and Escalated are live results
            for that run&apos;s cycle. "—" = not recorded by that run (the field was added later).
          </p>
        </Panel>
      </div>

      {current ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel
            title={`No contact on file (${current.recorded.no_contact ? noContact.length : "–"})`}
            description="Overdue branches with no phone and no email: not reachable automatically."
          >
            <ExceptionList
              recorded={current.recorded.no_contact}
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
            title={`Email only, no mobile (${current.recorded.email_only ? emailOnly.length : "–"})`}
            description="Reminder emailed, but no phone number for a call."
          >
            <ExceptionList
              recorded={current.recorded.email_only}
              rows={emailOnly.map((c) => ({
                main: c.client_name || "",
                sub: c.email || "",
                amount: c.amount || 0,
              }))}
            />
          </Panel>
        </div>
      ) : null}
    </AppShell>
  );
}

function ExceptionList({
  rows,
  recorded,
}: {
  rows: { main: string; sub: string; amount: number }[];
  recorded: boolean;
}) {
  if (!recorded) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Not recorded for this run (added from 21 Oct).
      </p>
    );
  }
  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="max-h-80 divide-y divide-border overflow-y-auto">
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
