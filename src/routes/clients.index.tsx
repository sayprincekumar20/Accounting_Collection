import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { downloadCsv } from "@/lib/csv";
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
  last_text_at?: string;
  last_text_channel?: string;
  last_text_source?: string;
  last_call_at?: string;
  last_call_source?: string;
  last_call_result?: string;
  contacted_via_call_command?: boolean;
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
  { value: "c_callcmd", label: "Contacted via /call" },
  { value: "c_notreached", label: "Last call: not reached" },
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
    case "c_callcmd":
      return !!c.contacted_via_call_command;
    case "c_notreached":
      return c.last_call_result === "Not reached" || c.last_call_result === "No answer";
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
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                "clients",
                [
                  "Client",
                  "Parent",
                  "Contact",
                  "Email",
                  "Phone",
                  "Amount due",
                  "Overdue",
                  "Due date",
                  "Sales person",
                  "AR owner",
                  "Promise until",
                  "AR handling until",
                  "Invoices",
                  "Last text",
                  "Last text by",
                  "Last call",
                  "Last call by",
                  "Last call result",
                ],
                filtered.map((c) => [
                  c.client_name,
                  c.parent_name ?? "",
                  c.contact_person,
                  c.email,
                  c.phone,
                  c.collection_amount,
                  c.overdue_total ?? "",
                  c.due_date,
                  c.sales_person ?? "",
                  "",
                  c.promise_suppressed_until ?? "",
                  c.ar_handoff_until ?? "",
                  c.invoice_numbers,
                  ((c.last_text_channel || "") + " " + (c.last_text_at || "")).trim(),
                  c.last_text_source ?? "",
                  c.last_call_at ?? "",
                  c.last_call_source ?? "",
                  c.last_call_result ?? "",
                ]),
              )
            }
            className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
          >
            Export CSV
          </button>
          <RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />
        </div>
      }
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
                <th className="px-4 py-2.5 font-semibold">Last contact</th>
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
                    <td className="px-4 py-3 text-xs">
                      <LastContact c={c} />
                    </td>
                  </tr>
                );
              })}
              {!isLoading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
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

/** Latest text and call (weekly run or /call), with who started it and the call result. */
function LastContact({ c }: { c: ClientRow }) {
  const when = (v?: string) =>
    v
      ? new Date(v).toLocaleString("en-PH", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "";
  const tone: Record<string, string> = {
    Answered: "text-success",
    "Retry pending": "text-warning",
    "In progress": "text-warning",
    "Not reached": "text-destructive",
    "No answer": "text-destructive",
  };
  if (!c.last_text_at && !c.last_call_at)
    return <span className="text-muted-foreground">Not contacted yet</span>;
  return (
    <div className="space-y-1">
      {c.last_text_at ? (
        <p>
          <span className="font-semibold">{c.last_text_channel === "SMS" ? "SMS" : "Email"}</span> ·{" "}
          {when(c.last_text_at)}
          <span className="block text-[11px] text-muted-foreground">{c.last_text_source}</span>
        </p>
      ) : null}
      {c.last_call_at ? (
        <p>
          <span className="font-semibold">Call</span> · {when(c.last_call_at)}
          {c.last_call_result ? (
            <span className={`ml-1 font-semibold ${tone[c.last_call_result] ?? ""}`}>
              {c.last_call_result}
            </span>
          ) : null}
          <span className="block text-[11px] text-muted-foreground">{c.last_call_source}</span>
        </p>
      ) : null}
    </div>
  );
}
