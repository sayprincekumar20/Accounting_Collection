import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/other-accounts")({
  head: () => ({ meta: [{ title: "Other Accounts | Rare Global Food Collections" }] }),
  component: OtherAccountsPage,
});

interface Item {
  client_id: string;
  client_name: string;
  parent_name: string;
  sales_person: string;
  ar_owner: string;
  contact_person: string;
  phone: string;
  email: string;
  overdue: number;
  current: number;
  total: number;
  branch_count: number;
  invoices: unknown[];
  refreshed_at: string;
  sales_team: boolean | null;
}

const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Clients with unpaid invoices whose CRM Account Owner is NOT in the 'Sales Team' group: read-only, never contacted. */
function OtherAccountsPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["contact-approvals"],
    queryFn: async () => {
      const r = await fetch("/api/contact-approvals");
      if (!r.ok) throw new Error("Fetch failed");
      return ((await r.json()).items ?? []) as Item[];
    },
    refetchInterval: 600000,
  });
  const items = useMemo(() => (data ?? []).filter((i) => i.sales_team === false), [data]);
  const [q, setQ] = useState("");
  const visible = items.filter(
    (i) =>
      !q ||
      `${i.client_name} ${i.ar_owner} ${i.contact_person} ${i.sales_person}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  const control =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <AppShell
      title="Other Accounts"
      subtitle="Clients whose CRM Account Owner is not in the Sales Team group · read-only · never texted or called"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Accounts (owner not in Sales Team)"
          value={String(items.length)}
          hint="Not contacted by /call or the automation"
        />
        <StatCard
          label="Outstanding"
          value={peso(items.reduce((t, i) => t + i.total, 0))}
          hint={peso(items.reduce((t, i) => t + i.overdue, 0)) + " overdue"}
        />
      </div>
      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search client, owner, contact…"
          className={`${control} min-w-[220px] flex-1`}
        />
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "other-accounts",
              [
                "Client",
                "Parent",
                "Account owner",
                "Sales person",
                "Contact",
                "Phone",
                "Email",
                "Branches",
                "Overdue",
                "Current",
                "Total",
              ],
              visible.map((i) => [
                i.client_name,
                i.parent_name,
                i.ar_owner,
                i.sales_person,
                i.contact_person,
                i.phone,
                i.email,
                i.branch_count,
                i.overdue,
                i.current,
                i.total,
              ]),
            )
          }
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
        >
          Export CSV
        </button>
      </div>
      <div className="mt-5">
        <Panel
          title="Not contacted: owner not in Sales Team"
          description={`${visible.length} shown`}
        >
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">Could not load accounts.</p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5 font-semibold">Client</th>
                  <th className="px-3 py-2.5 font-semibold">Account owner</th>
                  <th className="px-3 py-2.5 font-semibold">Contact</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Branches</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Overdue</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((i) => (
                  <tr key={i.client_id}>
                    <td className="px-3 py-3">
                      <p className="font-semibold">{i.client_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.sales_person ? `Sales: ${i.sales_person}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">{i.ar_owner || "–"}</td>
                    <td className="px-3 py-3 text-xs">
                      <p className="font-semibold">{i.contact_person || "No contact person"}</p>
                      <p>{i.phone || "No phone"}</p>
                      <p className="truncate">{i.email || "No email"}</p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{i.branch_count}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-destructive">
                      {i.overdue ? peso(i.overdue) : "–"}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {peso(i.total)}
                    </td>
                  </tr>
                ))}
                {!isLoading && visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      None. (Accounts appear here after their next Zoho refresh.)
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
