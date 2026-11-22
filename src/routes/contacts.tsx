import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RefreshButton } from "@/components/collections/Bits";
import { SkeletonRows } from "@/components/collections/Skeleton";
import { Pager } from "@/components/collections/Pager";
import { downloadCsv } from "@/lib/csv";
import {
  CONTACT_TABS,
  ISSUE_INFO,
  inTab,
  type ContactIssue,
  type ContactTab,
} from "@/lib/contact-issues";

// Contacts to Fix: one list, tabs by kind of problem (like Escalations), one search, pagination.
// Live data (Clients + bounces + wrong-contact escalations); the last weekly run's branch lists are a tab.
export const Route = createFileRoute("/contacts")({
  head: () => ({ meta: [{ title: "Contacts to Fix | Rare Global Food Collections" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: ContactTab } => {
    const t = String(search["tab"] ?? "");
    return CONTACT_TABS.some((x) => x.id === t) && t !== "all" ? { tab: t as ContactTab } : {};
  },
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
  issues: ContactIssue[];
  reach: { email: boolean; phone: boolean };
}
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
interface RunRow {
  key: string;
  problem: "No contact on file" | "Email only, no mobile";
  name: string;
  sub: string;
  amount: number;
}

const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (v: string) =>
  v
    ? new Date(v).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const control =
  "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function ContactsPage() {
  const { tab = "all" } = Route.useSearch();
  const contacts = useQuery({
    queryKey: ["contacts-to-fix"],
    queryFn: async () => {
      const r = await fetch("/api/contacts-to-fix");
      if (!r.ok) throw new Error("Fetch failed");
      return ((await r.json()).items ?? []) as Item[];
    },
    refetchInterval: 3600000,
  });
  const runs = useQuery({
    queryKey: ["daily-run-logs"],
    queryFn: async () => {
      const r = await fetch("/api/daily-run-logs");
      if (!r.ok) throw new Error("Run logs fetch failed");
      return ((await r.json()).runs ?? []) as RunLog[];
    },
  });
  const items = useMemo(() => contacts.data ?? [], [contacts.data]);
  const run = (runs.data ?? [])[0];
  const runRows = useMemo<RunRow[]>(() => {
    if (!run) return [];
    return [
      ...(run.no_contact_details ?? []).map((b, k) => ({
        key: `nc${k}`,
        problem: "No contact on file" as const,
        name: b.branch_name || b.parent_name || "",
        sub: [
          b.parent_name !== b.branch_name ? b.parent_name : "",
          b.invoices ? `Invoices ${b.invoices}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        amount: b.amount || 0,
      })),
      ...(run.email_only_details ?? []).map((c, k) => ({
        key: `eo${k}`,
        problem: "Email only, no mobile" as const,
        name: c.client_name || "",
        sub: c.email || "",
        amount: c.amount || 0,
      })),
    ];
  }, [run]);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"balance" | "name">("balance");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setPage(0);
    setOpen(null);
  }, [tab, q, sort, pageSize]);

  const counts = Object.fromEntries(
    CONTACT_TABS.map((t) => [
      t.id,
      t.id === "run" ? runRows.length : items.filter((i) => inTab(t.id, i)).length,
    ]),
  ) as Record<ContactTab, number>;
  const s = q.trim().toLowerCase();
  const sorter = <T extends { name: string; amount: number }>(a: T, b: T) =>
    sort === "name" ? a.name.localeCompare(b.name) : b.amount - a.amount;

  const visible = items
    .filter((i) => inTab(tab, i))
    .filter(
      (i) =>
        !s ||
        `${i.client_name} ${i.parent_name} ${i.contact_person} ${i.email} ${i.phone} ${i.ar_owner} ${i.sales_person}`
          .toLowerCase()
          .includes(s),
    )
    .map((i) => ({ ...i, name: i.client_name, amount: i.balance }))
    .sort(sorter);
  const visibleRun = runRows
    .filter((r) => !s || `${r.name} ${r.sub} ${r.problem}`.toLowerCase().includes(s))
    .sort(sorter);
  const total = tab === "run" ? visibleRun.length : visible.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = <T,>(list: T[]) => list.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const outstanding = items.reduce((t, i) => t + i.balance, 0);
  const isFetching = contacts.isFetching || runs.isFetching;

  function exportCsv() {
    const label = CONTACT_TABS.find((t) => t.id === tab)?.label ?? "All";
    if (tab === "run")
      return downloadCsv(
        "contacts-to-fix-weekly-run",
        ["Problem", "Branch / client", "Details", "Amount"],
        visibleRun.map((r) => [r.problem, r.name, r.sub, r.amount]),
      );
    downloadCsv(
      `contacts-to-fix-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      [
        "Client",
        "Parent",
        "Contact",
        "Email",
        "Phone",
        "AR owner",
        "Sales person",
        "Balance",
        "Reachable by",
        "Problems",
        "How to fix",
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
        [i.reach.email ? "Email" : "", i.reach.phone ? "SMS / call" : ""]
          .filter(Boolean)
          .join(", ") || "Not reachable",
        i.issues.map((x) => (x.detail ? `${x.label}: ${x.detail}` : x.label)).join("; "),
        [...new Set(i.issues.map((x) => ISSUE_INFO[x.code].fix))].join(" "),
      ]),
    );
  }

  return (
    <AppShell
      title="Contacts to Fix"
      subtitle="Clients whose contact details must be corrected in Zoho CRM before reminders can reach them"
      actions={
        <RefreshButton
          isFetching={isFetching}
          onRefresh={() => {
            void contacts.refetch();
            void runs.refetch();
          }}
        />
      }
    >
      <div
        className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1"
        role="tablist"
        aria-label="Problem type"
      >
        {CONTACT_TABS.map((t) => (
          <Link
            key={t.id}
            to="/contacts"
            search={t.id === "all" ? {} : { tab: t.id }}
            role="tab"
            aria-selected={tab === t.id}
            title={t.hint}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "border border-border hover:bg-muted"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                tab === t.id
                  ? "bg-primary-foreground/20"
                  : t.id === "unreachable" && counts[t.id]
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {counts[t.id]}
            </span>
          </Link>
        ))}
      </div>

      <p className="mb-4 text-sm text-muted-foreground" aria-label="Summary">
        <span className="font-semibold text-foreground">{items.length} clients</span> to fix ·{" "}
        {peso(outstanding)} outstanding ·{" "}
        <span className={counts.unreachable ? "font-semibold text-destructive" : ""}>
          {counts.unreachable} can't be reached at all
        </span>
        {tab === "run" && run ? ` · weekly run of ${when(run.run_timestamp || run.run_date)}` : ""}
      </p>

      <div className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border p-3">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            placeholder={
              tab === "run"
                ? "Search branch, client, invoice, email…"
                : "Search client, contact, email, phone, AR owner…"
            }
            aria-label="Search"
            className={`${control} min-w-[220px] flex-1`}
          />
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as "balance" | "name");
            }}
            aria-label="Sort"
            className={control}
          >
            <option value="balance">Biggest balance first</option>
            <option value="name">Name A to Z</option>
          </select>
          <button
            type="button"
            onClick={exportCsv}
            className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
          >
            Export CSV
          </button>
        </div>
        <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {CONTACT_TABS.find((t) => t.id === tab)?.hint}
        </p>

        {tab === "run" ? (
          <RunTable rows={slice(visibleRun)} loading={runs.isLoading} recorded={!!run} />
        ) : (
          <>
            <div className="hidden grid-cols-[1.5fr_1.5fr_1.7fr_0.9fr_0.9fr] gap-3 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
              <span>Client</span>
              <span>Contact on file</span>
              <span>Problems</span>
              <span>Can reach by</span>
              <span className="text-right">Balance</span>
            </div>
            {contacts.isLoading ? <SkeletonRows /> : null}
            {contacts.error ? (
              <p className="px-4 py-6 text-sm text-destructive">Could not load.</p>
            ) : null}
            <ul className="divide-y divide-border">
              {slice(visible).map((i) => (
                <ClientRow
                  key={i.client_id}
                  item={i}
                  open={open === i.client_id}
                  onToggle={() => {
                    setOpen(open === i.client_id ? null : i.client_id);
                  }}
                />
              ))}
              {!contacts.isLoading && !visible.length ? (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {s ? "No client matches the search." : "Nothing to fix here."}
                </li>
              ) : null}
            </ul>
          </>
        )}
        <Pager
          total={total}
          page={safePage}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </div>
    </AppShell>
  );
}

function ClientRow({
  item: i,
  open,
  onToggle,
}: {
  item: Item;
  open: boolean;
  onToggle: () => void;
}) {
  const bad = (field: "email" | "phone") =>
    i.issues.some((x) => ISSUE_INFO[x.code].field === field);
  const fixes = [...new Set(i.issues.map((x) => ISSUE_INFO[x.code].fix))];
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full gap-2 px-4 py-3 text-left hover:bg-muted/40 md:grid-cols-[1.5fr_1.5fr_1.7fr_0.9fr_0.9fr] md:gap-3"
      >
        <span className="flex min-w-0 gap-1.5">
          {open ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{i.client_name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {[i.ar_owner && `AR ${i.ar_owner}`, i.sales_person].filter(Boolean).join(" · ")}
            </span>
          </span>
        </span>
        <span className="min-w-0 text-xs">
          <span className="block truncate">
            {i.contact_person || <span className="text-muted-foreground">no contact person</span>}
          </span>
          <span
            className={`block truncate ${bad("email") ? "text-destructive line-through" : "text-muted-foreground"}`}
          >
            {i.email || "no email"}
          </span>
          <span className={`block ${bad("phone") ? "text-destructive" : "text-muted-foreground"}`}>
            {i.phone || "no phone"}
          </span>
        </span>
        <span className="flex flex-wrap content-start gap-1">
          {i.issues.map((x) => (
            <span
              key={x.code}
              className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive"
            >
              {x.label}
            </span>
          ))}
        </span>
        <span className="flex flex-wrap content-start gap-1 text-[11px] font-semibold">
          {i.reach.email ? (
            <span className="rounded-full bg-success/12 px-2 py-0.5 text-success">Email</span>
          ) : null}
          {i.reach.phone ? (
            <span className="rounded-full bg-success/12 px-2 py-0.5 text-success">SMS / call</span>
          ) : null}
          {!i.reach.email && !i.reach.phone ? (
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-destructive">
              Not reachable
            </span>
          ) : null}
        </span>
        <span className="text-sm font-semibold tabular-nums md:text-right">{peso(i.balance)}</span>
      </button>
      {open ? (
        <div className="grid gap-3 bg-muted/30 px-4 pb-4 pt-1 text-xs md:grid-cols-2 md:pl-10">
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
              What is wrong
            </p>
            <ul className="space-y-1">
              {i.issues.map((x) => (
                <li key={x.code}>
                  <span className="font-semibold">{x.label}</span>
                  {x.detail ? <span className="text-muted-foreground"> · {x.detail}</span> : null}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
              How to fix
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {fixes.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <Link
              to="/clients/$clientId"
              params={{ clientId: i.client_id }}
              className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              Open client <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function RunTable({
  rows,
  loading,
  recorded,
}: {
  rows: RunRow[];
  loading: boolean;
  recorded: boolean;
}) {
  if (loading) return <SkeletonRows />;
  if (!recorded)
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        No weekly run recorded yet.
      </p>
    );
  return (
    <>
      <div className="hidden grid-cols-[1.1fr_2fr_2fr_0.9fr] gap-3 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
        <span>Problem</span>
        <span>Branch / client</span>
        <span>Details</span>
        <span className="text-right">Amount</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li
            key={r.key}
            className="grid gap-1 px-4 py-2.5 md:grid-cols-[1.1fr_2fr_2fr_0.9fr] md:gap-3"
          >
            <span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  r.problem === "No contact on file"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/15 text-warning"
                }`}
              >
                {r.problem}
              </span>
            </span>
            <span className="truncate text-sm font-medium">{r.name}</span>
            <span className="truncate text-xs text-muted-foreground">{r.sub}</span>
            <span className="text-sm tabular-nums md:text-right">{peso(r.amount)}</span>
          </li>
        ))}
        {!rows.length ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">None.</li>
        ) : null}
      </ul>
    </>
  );
}
