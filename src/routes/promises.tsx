import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/promises")({
  head: () => ({ meta: [{ title: "Payment Promises | Rare Global Food Collections" }] }),
  component: PromisesPage,
});

interface Item {
  client_id: string;
  client_name: string;
  contact_person: string;
  phone: string;
  email: string;
  ar_owner: string;
  channel: string;
  promise_date: string;
  recorded_at: string;
  reason: string;
  balance: number;
  state: "DUE_TODAY" | "UPCOMING" | "BROKEN" | "KEPT" | "UNKNOWN";
}
const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayLabel = (d: string) =>
  d
    ? new Date(`${d}T00:00:00+08:00`).toLocaleDateString("en-PH", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const LABEL: Record<string, string> = {
  DUE_TODAY: "Due today",
  UPCOMING: "Upcoming",
  BROKEN: "Broken",
  KEPT: "Kept / paid",
  UNKNOWN: "No date",
};
const TONE: Record<string, string> = {
  DUE_TODAY: "bg-warning/15 text-warning",
  UPCOMING: "bg-secondary text-secondary-foreground",
  BROKEN: "bg-destructive/12 text-destructive",
  KEPT: "bg-success/12 text-success",
  UNKNOWN: "bg-muted text-muted-foreground",
};

function PromisesPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["promises-board"],
    queryFn: async () => {
      const r = await fetch("/api/promises-board");
      if (!r.ok) throw new Error("Promises fetch failed");
      return ((await r.json()).items ?? []) as Item[];
    },
    refetchInterval: 600000,
  });
  const items = data ?? [];
  const [state, setState] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const count = (st: string) => items.filter((i) => i.state === st).length;
  const sum = (st: string) =>
    items.filter((i) => i.state === st).reduce((t, i) => t + i.balance, 0);
  const visible = items.filter(
    (i) =>
      (state === "ALL" || i.state === state) &&
      (!q ||
        `${i.client_name} ${i.contact_person} ${i.ar_owner}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  return (
    <AppShell
      title="Payment Promises"
      subtitle="Latest promise per client · broken = the date passed and the client still owes money"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["DUE_TODAY", "BROKEN", "UPCOMING", "KEPT"] as const).map((st) => (
          <StatCard
            key={st}
            label={LABEL[st] ?? st}
            value={String(count(st))}
            hint={st === "KEPT" ? "" : peso(sum(st))}
            tone={st === "BROKEN" ? "primary" : "default"}
            onClick={() => setState(state === st ? "ALL" : st)}
            active={state === st}
          />
        ))}
      </div>
      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search client, contact, AR owner…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-background px-2.5 text-sm"
        />
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "payment-promises",
              [
                "Client",
                "Contact",
                "Phone",
                "Email",
                "AR owner",
                "Channel",
                "Promise date",
                "Status",
                "Balance",
                "Recorded at",
                "Note",
              ],
              visible.map((i) => [
                i.client_name,
                i.contact_person,
                i.phone,
                i.email,
                i.ar_owner,
                i.channel,
                i.promise_date,
                LABEL[i.state],
                i.balance,
                i.recorded_at,
                i.reason,
              ]),
            )
          }
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
        >
          Export CSV
        </button>
      </div>
      <div className="mt-5">
        <Panel title="Promises" description={`${visible.length} shown · earliest date first`}>
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">Could not load promises.</p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 font-semibold">AR owner</th>
                  <th className="px-4 py-2.5 font-semibold">Channel</th>
                  <th className="px-4 py-2.5 font-semibold">Promise date</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Balance now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((i) => (
                  <tr key={i.client_id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{i.client_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[i.contact_person, i.phone].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="px-4 py-3">{i.ar_owner || "—"}</td>
                    <td className="px-4 py-3 text-xs font-semibold">{i.channel || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dayLabel(i.promise_date)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[i.state]}`}
                      >
                        {LABEL[i.state]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{peso(i.balance)}</td>
                  </tr>
                ))}
                {!isLoading && visible.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nothing here.
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
