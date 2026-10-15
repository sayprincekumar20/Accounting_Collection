import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  LogFilterBar,
  matchesLogFilters,
  useLogFilters,
} from "@/components/collections/LogFilters";
import { Panel, StatusPill, RefreshButton } from "@/components/collections/Bits";

export const Route = createFileRoute("/clients/")({
  head: () => ({
    meta: [
      { title: "Client Ledger | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Every overdue account with reachable channels, outstanding balance, invoices and status, synced live from n8n.",
      },
      { property: "og:title", content: "Client Ledger | Rare Global Food Collections" },
    ],
  }),
  component: ClientsPage,
});

interface ClientRow {
  client_id: string;
  client_name: string;
  parent_name: string;
  contact_person: string;
  email: string;
  phone: string;
  gmail_available: boolean;
  sms_available: boolean;
  voice_available: boolean;
  whatsapp_available: boolean;
  viber_available: boolean;
  collection_amount: number;
  due_date: string;
  status: string;
  invoice_numbers: string;
  overdue_total?: number;
  promise_suppressed_until?: string;
  suppression_reason?: string;
  ar_handoff_until?: string;
  sales_person?: string;
}

const CLIENT_STATUSES = [
  { value: "all", label: "All clients" },
  { value: "c_promise", label: "Payment promise active" },
  { value: "c_handoff", label: "AR team handling (escalated)" },
  { value: "c_email", label: "Email clients" },
  { value: "c_sms", label: "Phone only (SMS)" },
  { value: "c_nocontact", label: "No contact channel" },
  { value: "c_overdue", label: "Has overdue invoices" },
];
const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const activeUntil = (v?: string) => !!v && new Date(v).getTime() >= todayStart();
function clientStatusMatch(c: ClientRow, status: string) {
  switch (status) {
    case "c_promise":
      return activeUntil(c.promise_suppressed_until) && c.suppression_reason !== "ar_handoff";
    case "c_handoff":
      return activeUntil(c.ar_handoff_until);
    case "c_email":
      return !!c.email;
    case "c_sms":
      return !c.email && !!c.phone;
    case "c_nocontact":
      return !c.email && !c.phone;
    case "c_overdue":
      return Number(c.overdue_total || 0) > 0;
    default:
      return true;
  }
}

function peso(v: number) {
  return "PHP " + Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}
function shortDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return v;
  }
}
function daysOverdue(v: string | null | undefined) {
  if (!v) return 0;
  const diff = Date.now() - new Date(v).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function useClients() {
  return useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const r = await fetch("/api/clients-list");
      if (!r.ok) throw new Error("Clients fetch failed");
      const d = await r.json();
      return (d.clients ?? []) as ClientRow[];
    },
    refetchInterval: 14400000, // 4 hours -- see hard-refresh button for on-demand updates
  });
}

function ClientsPage() {
  const { data, isLoading, isFetching, error, refetch } = useClients();
  const clients = data ?? [];
  const [filters, setFilters, clearFilters] = useLogFilters();
  const { data: queue } = useQuery({
    queryKey: ["reminder-queue-list"],
    queryFn: async () => {
      const r = await fetch("/api/reminder-queue-list");
      if (!r.ok) return [];
      const d = await r.json();
      return (d.queue ?? []) as {
        client_id: string;
        trigger_source?: string;
        queue_status?: string;
        preferred_channel?: string;
      }[];
    },
    refetchInterval: 14400000,
  });
  const queueByClient = new Map((queue ?? []).map((q) => [q.client_id, q]));
  const sourceByClient = new Map((queue ?? []).map((q) => [q.client_id, q.trigger_source || ""]));
  const statusIsMine = CLIENT_STATUSES.some((o) => o.value === filters.status);
  const filtered = clients.filter(
    (c) =>
      (!statusIsMine || clientStatusMatch(c, filters.status)) &&
      matchesLogFilters(
        {
          name: `${c.client_name} ${c.parent_name ?? ""}`,
          contact: c.contact_person,
          extra: `${c.email ?? ""} ${c.phone ?? ""} ${c.invoice_numbers ?? ""} ${c.sales_person ?? ""}`,
          lastActivity: c.due_date,
          source: sourceByClient.get(c.client_id),
        },
        { ...filters, status: "all" },
      ),
  );
  return (
    <AppShell
      title="Clients"
      subtitle="Overdue accounts and the channels we can reach them on · live"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="mb-5">
        <LogFilterBar
          filters={filters}
          onChange={setFilters}
          onClear={clearFilters}
          shown={filtered.length}
          total={clients.length}
          statusOptions={CLIENT_STATUSES}
          rangeLabel="Any due date"
          searchPlaceholder="Search client, contact, email, phone, invoice, sales person…"
        />
      </div>
      <Panel title="Client ledger" description={`${filtered.length} accounts`}>
        {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
        {error ? <p className="p-4 text-sm text-destructive">Could not load clients.</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Channels</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount due</th>
                <th className="px-4 py-2.5 font-semibold">Due date</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c) => {
                // The channel actually used for this client (Viber is paused, phone-only clients get SMS),
                // plus Voice when there is a phone number.
                const used = String(
                  queueByClient.get(c.client_id)?.preferred_channel ||
                    (c.email ? "EMAIL" : c.phone ? "SMS" : ""),
                ).toUpperCase();
                const channels = [
                  used === "EMAIL"
                    ? "Email"
                    : used === "SMS"
                      ? "SMS"
                      : used === "WHATSAPP"
                        ? "WhatsApp"
                        : used === "VIBER"
                          ? "Viber"
                          : "",
                  c.phone ? "Voice" : "",
                ].filter(Boolean) as string[];
                return (
                  <tr key={c.client_id} className="hover:bg-muted/60">
                    <td className="px-4 py-3">
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: c.client_id }}
                        className="font-semibold text-primary hover:underline"
                      >
                        {c.client_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.contact_person ? `${c.contact_person} · ` : ""}
                        {c.parent_name ?? "Direct account"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {channels.length ? channels.join(" · ") : "No contact channel"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {peso(c.collection_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span>{shortDate(c.due_date)}</span>
                      <DueText due={c.due_date} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        status={String(
                          queueByClient.get(c.client_id)?.queue_status || c.status || "",
                        ).toLowerCase()}
                      />
                      {activeUntil(c.ar_handoff_until) ? (
                        <span className="mt-1 block text-[11px] font-semibold text-destructive">
                          AR handling until {shortDate(c.ar_handoff_until)}
                        </span>
                      ) : activeUntil(c.promise_suppressed_until) ? (
                        <span className="mt-1 block text-[11px] font-semibold text-success">
                          Promise until {shortDate(c.promise_suppressed_until)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No clients found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}

/** "28 days overdue" / "Due today" / "Due in 3 days" (a future due date is not overdue). */
function DueText({ due }: { due: string | null | undefined }) {
  if (!due) return null;
  const d = new Date(due);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (days > 0) return <p className="text-xs text-destructive">{days} days overdue</p>;
  if (days === 0) return <p className="text-xs font-semibold text-warning">Due today</p>;
  return <p className="text-xs text-muted-foreground">Due in {-days} days</p>;
}
