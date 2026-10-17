import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/contacts")({
  head: () => ({ meta: [{ title: "Contacts to Fix | Rare Global Food Collections" }] }),
  component: ContactsPage,
});

interface Item {
  client_id: string;
  client_name: string;
  parent_name: string;
  contact_person: string;
  email: string;
  phone: string;
  ar_owner: string;
  sales_person: string;
  balance: number;
  issues: string[];
}
const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ContactsPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["contacts-to-fix"],
    queryFn: async () => {
      const r = await fetch("/api/contacts-to-fix");
      if (!r.ok) throw new Error("Fetch failed");
      return ((await r.json()).items ?? []) as Item[];
    },
    refetchInterval: 3600000,
  });
  const items = data ?? [];
  const [q, setQ] = useState("");
  const [issue, setIssue] = useState("ALL");
  const kinds = [...new Set(items.flatMap((i) => i.issues.map((x) => x.split(":")[0] ?? x)))];
  const visible = items.filter(
    (i) =>
      (issue === "ALL" || i.issues.some((x) => x.startsWith(issue))) &&
      (!q ||
        `${i.client_name} ${i.parent_name} ${i.contact_person} ${i.email} ${i.phone} ${i.ar_owner} ${i.sales_person}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  return (
    <AppShell
      title="Contacts to Fix"
      subtitle="Clients whose contact details should be corrected in Zoho CRM / Inventory · biggest balance first"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Clients to fix"
          value={String(items.length)}
          tone="primary"
          hint={peso(items.reduce((t, i) => t + i.balance, 0)) + " outstanding"}
        />
        <StatCard
          label="No phone and no email"
          value={String(items.filter((i) => i.issues.includes("No phone and no email")).length)}
          onClick={() =>
            setIssue(issue === "No phone and no email" ? "ALL" : "No phone and no email")
          }
          active={issue === "No phone and no email"}
        />
        <StatCard
          label="Wrong / former contact"
          value={String(
            items.filter((i) => i.issues.some((x) => x.startsWith("Escalated as wrong"))).length,
          )}
          onClick={() =>
            setIssue(
              issue === "Escalated as wrong / former contact"
                ? "ALL"
                : "Escalated as wrong / former contact",
            )
          }
          active={issue === "Escalated as wrong / former contact"}
        />
      </div>
      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search client, contact, email, phone, AR owner…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-background px-2.5 text-sm"
        />
        <select
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          aria-label="Issue"
        >
          <option value="ALL">All issues</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "contacts-to-fix",
              [
                "Client",
                "Parent",
                "Contact",
                "Email",
                "Phone",
                "AR owner",
                "Sales person",
                "Balance",
                "Issues",
              ],
              visible.map((i) => [
                i.client_name,
                i.parent_name,
                i.contact_person,
                i.email,
                i.phone,
                i.ar_owner,
                i.sales_person,
                i.balance,
                i.issues.join("; "),
              ]),
            )
          }
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
        >
          Export CSV
        </button>
      </div>
      <div className="mt-5">
        <Panel title="Clients" description={`${visible.length} shown`}>
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? <p className="px-4 py-6 text-sm text-destructive">Could not load.</p> : null}
          <ul className="divide-y divide-border">
            {visible.map((i) => (
              <li key={i.client_id} className="grid gap-2 px-4 py-3 md:grid-cols-[1.3fr_1.2fr_2fr]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{i.client_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {peso(i.balance)} {i.ar_owner ? `· AR ${i.ar_owner}` : ""}{" "}
                    {i.sales_person ? `· ${i.sales_person}` : ""}
                  </p>
                </div>
                <div className="min-w-0 text-xs">
                  <p>
                    {i.contact_person || (
                      <span className="text-muted-foreground">no contact person</span>
                    )}
                  </p>
                  <p className="truncate text-muted-foreground">{i.email || "no email"}</p>
                  <p className="text-muted-foreground">{i.phone || "no phone"}</p>
                </div>
                <ul className="space-y-0.5 text-xs">
                  {i.issues.map((x) => (
                    <li key={x} className="text-destructive">
                      • {x}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {!isLoading && visible.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing to fix.
              </li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}
