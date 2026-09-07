import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard } from "@/components/collections/Bits";
import { clientsQuery, peso, runLogsQuery, shortDate } from "@/lib/collections";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Daily Run Reports | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Daily overdue run history: processed accounts, outstanding totals, queued channels, no-contact and email-only exceptions.",
      },
      { property: "og:title", content: "Daily Run Reports | Rare Global Food Collections" },
      {
        property: "og:description",
        content: "Run-by-run history of the automated overdue reminder process.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(runLogsQuery),
      context.queryClient.ensureQueryData(clientsQuery),
    ]);
  },
  component: ReportsPage,
});

function ReportsPage() {
  const { data: runs } = useSuspenseQuery(runLogsQuery);
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const noContact = clients.filter((c) => c.status === "no_contact");
  const emailOnly = clients.filter((c) => c.status === "email_only");
  const max = Math.max(...runs.map((r) => r.total_processed), 1);

  return (
    <AppShell title="Reports" subtitle="Daily overdue run history and exception lists">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Runs logged" value={String(runs.length)} tone="primary" />
        <StatCard
          label="No contact"
          value={String(noContact.length)}
          hint={peso(noContact.reduce((s, c) => s + Number(c.collection_amount), 0))}
        />
        <StatCard
          label="Email only"
          value={String(emailOnly.length)}
          hint={peso(emailOnly.reduce((s, c) => s + Number(c.collection_amount), 0))}
        />
      </div>

      <div className="mt-5 space-y-5">
        <Panel title="Processed per run" description="Last 12 daily runs">
          <div className="flex h-40 items-end gap-2 px-4 py-4">
            {runs
              .slice()
              .reverse()
              .map((r) => (
                <div key={r.id} className="flex min-w-0 flex-1 flex-col items-center gap-1">
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
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Run date</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Processed</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="px-4 py-2.5 text-right font-semibold">WhatsApp</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Viber</th>
                  <th className="px-4 py-2.5 text-right font-semibold">SMS</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Email</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Voice</th>
                  <th className="px-4 py-2.5 text-right font-semibold">No contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3 font-semibold">{shortDate(r.run_date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.total_processed}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {peso(r.total_outstanding)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.whatsapp_queued}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.viber_queued}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.sms_queued}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.email_queued}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.voice_queued}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.no_contact_count} · {peso(r.no_contact_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="No contact on file" description="Needs a phone number or email">
            <ul className="divide-y divide-border text-sm">
              {noContact.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-semibold">{c.client_name}</p>
                    <p className="text-xs text-muted-foreground">{c.invoice_numbers}</p>
                  </div>
                  <span className="tabular-nums font-semibold">{peso(c.collection_amount)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Email only" description="Follow up by phone as well">
            <ul className="divide-y divide-border text-sm">
              {emailOnly.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{c.client_name}</p>
                    <span className="tabular-nums font-semibold">{peso(c.collection_amount)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{c.email}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
