import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Panel, StatusPill } from "@/components/collections/Bits";
import {
  clientsQuery,
  daysOverdue,
  messagesQuery,
  peso,
  shortDate,
} from "@/lib/collections";

export const Route = createFileRoute("/clients/")({
  head: () => ({
    meta: [
      { title: "Client Ledger | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Every overdue account with reachable channels, outstanding balance, invoices and last contact date.",
      },
      { property: "og:title", content: "Client Ledger | Rare Global Food Collections" },
      {
        property: "og:description",
        content: "Overdue accounts with reachable channels, balances, invoices and last contact.",
      },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(clientsQuery),
      context.queryClient.ensureQueryData(messagesQuery),
    ]);
  },
  component: ClientsPage,
});

function ClientsPage() {
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const { data: messages } = useSuspenseQuery(messagesQuery);
  const [search, setSearch] = useState("");

  const filtered = clients.filter((c) =>
    `${c.client_name} ${c.parent_name ?? ""} ${c.email ?? ""} ${c.invoice_numbers ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <AppShell
      title="Clients"
      subtitle="Overdue accounts and the channels we can reach them on"
      actions={
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client, invoice or email…"
          className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40 sm:w-72"
        />
      }
    >
      <Panel title="Client ledger" description={`${filtered.length} accounts`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
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
                const last = messages.find((m) => m.client_id === c.id);
                const channels = [
                  c.whatsapp_available && "WhatsApp",
                  c.viber_available && "Viber",
                  c.sms_available && "SMS",
                  c.gmail_available && "Email",
                  c.voice_available && "Voice",
                ].filter(Boolean) as string[];
                return (
                  <tr key={c.id} className="hover:bg-muted/60">
                    <td className="px-4 py-3">
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: c.id }}
                        className="font-semibold text-primary hover:underline"
                      >
                        {c.client_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.parent_name ?? "Direct account"} · {c.ar_owner ?? "Unassigned"}
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
                      <p className="text-xs text-destructive">
                        {daysOverdue(c.due_date)} days overdue
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {last ? shortDate(last.occurred_at) : "Never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
