import { nextAttemptLabel } from "@/lib/retry-schedule";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SkeletonRows } from "@/components/collections/Skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";
import { downloadCsv } from "@/lib/csv";
import { ownerName } from "@/lib/owner";
import { ScheduleLine } from "@/components/collections/ScheduleBadge";
import { CreditLine } from "@/components/collections/CreditLine";
import { Pager } from "@/components/collections/Pager";
import { OtherAccountsContent } from "./other-accounts";
import { InvoiceTable, InvoiceToggle } from "@/components/collections/InvoiceTable";

export const Route = createFileRoute("/approvals")({
  head: () => ({ meta: [{ title: "Contact Approvals | Rare Global Food Collections" }] }),
  component: ApprovalsPage,
});

interface Invoice {
  branch: string;
  number: string;
  date: string;
  due: string;
  amount: number;
  balance: number;
  status: string;
  po: string;
}
interface Item {
  credit_terms?: string;
  credit_limit?: number | null;
  collection_schedule?: string;
  client_id: string;
  client_name: string;
  parent_name: string;
  segment: string;
  sales_person: string;
  ar_owner: string;
  contact_person: string;
  phone: string;
  email: string;
  overdue: number;
  current: number;
  total: number;
  due_date: string;
  promise_until: string;
  ar_handoff_until: string;
  refreshed_at: string;
  invoices: Invoice[];
  approved: boolean;
  approved_by: string;
  approved_at: string;
  approval_note: string;
  allow_multibranch?: boolean;
  branch_count: number;
  multibranch: boolean;
  sales_team: boolean | null;
  approval_expired: boolean;
  text_this_cycle: boolean;
  call_this_cycle: boolean;
  last_text_at: string;
  last_text_channel: string;
  last_text_source: string;
  last_call_at: string;
  last_call_source: string;
  last_call_result: string;
  next_retry_at?: string;
  retry_reason?: string;
}

const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (v: string) =>
  v
    ? new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "";
const when = (v: string) =>
  v
    ? new Date(v).toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const future = (v: string) => !!v && new Date(v).getTime() >= new Date().setHours(0, 0, 0, 0);

function ApprovalsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["contact-approvals"],
    queryFn: async () => {
      const r = await fetch("/api/contact-approvals");
      if (!r.ok) throw new Error("Approvals fetch failed");
      return ((await r.json()).items ?? []) as Item[];
    },
    refetchInterval: 600000,
  });
  // Clients whose CRM Account Owner is not in the 'Sales Team' group are never contacted: they are on the
  // 'Other Accounts' tab, not here.
  const all = useMemo(() => (data ?? []).filter((i) => i.sales_team !== false), [data]);
  // 5+ branch accounts are never texted or called (AR handles them): not in the approval list, shown apart.
  const items = useMemo(() => all.filter((i) => !i.multibranch), [all]);
  const multibranch = useMemo(() => all.filter((i) => i.multibranch), [all]);
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "ALL">("PENDING");
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Two blocks: clients with overdue invoices, and clients with only current (not yet due) invoices.
  const [kind, setKind] = useState<"OVERDUE" | "CURRENT" | "OTHER">(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tab") === "other"
      ? "OTHER"
      : "OVERDUE",
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    try {
      setName(sessionStorage.getItem("rgf-handler-name") || "");
    } catch {
      // ignore
    }
  }, []);

  const visible = items.filter(
    (i) =>
      (kind === "OVERDUE" ? i.overdue > 0 : i.overdue <= 0) &&
      (status === "ALL" || (status === "APPROVED" ? i.approved : !i.approved)) &&
      (!overdueOnly || i.overdue > 0) &&
      (!q ||
        `${i.client_name} ${i.parent_name} ${i.contact_person} ${i.phone} ${i.email} ${i.sales_person} ${i.ar_owner}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  const overdueCount = items.filter((i) => i.overdue > 0).length;
  const currentOnlyCount = items.filter((i) => i.overdue <= 0).length;
  // Other accounts: CRM owner not in the Sales Team group, and internal Rare accounts (never contacted).
  const otherCount = (data ?? []).filter((i) => i.sales_team === false).length;
  const paged = visible.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => setPage(0), [kind, status, q, overdueOnly, pageSize]);
  // Data cycle: the weekly refresh is the earliest 'Data from Zoho' time; later ones were refreshed since
  // (contact now / pre-send on the client's collection day).
  const refreshTimes = all.map((i) => new Date(i.refreshed_at).getTime()).filter((t) => t > 0);
  const weeklyAt = refreshTimes.length ? Math.min(...refreshTimes) : 0;
  const refreshedSince = refreshTimes.filter((t) => t - weeklyAt > 3 * 3600000).length;
  const manilaNow = new Date(Date.now() + 8 * 3600000);
  const cycleStartMs = Date.UTC(
    manilaNow.getUTCFullYear(),
    manilaNow.getUTCMonth(),
    manilaNow.getUTCDate() - ((manilaNow.getUTCDay() - 3 + 7) % 7),
  );
  const cycleDay = (ms: number) =>
    new Date(ms).toLocaleDateString("en-PH", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const pending = items.filter((i) => !i.approved);
  const approved = items.filter((i) => i.approved);

  const askName = () => {
    let who = name.trim();
    if (!who) {
      const entered = window.prompt("Your name (recorded as 'approved by'):", "");
      if (entered === null || !entered.trim()) return "";
      who = entered.trim();
      setName(who);
      try {
        sessionStorage.setItem("rgf-handler-name", who);
      } catch {
        // ignore
      }
    }
    return who;
  };

  // 5+ branch accounts: approve (5+ branches allowed) and start the contact right away (same as /call).
  const [selectedMulti, setSelectedMulti] = useState<Set<string>>(new Set());
  const [openMulti, setOpenMulti] = useState<string | null>(null);
  // Contact approved clients now (replaces the Zoho Cliq /call): same process and checks.
  async function contactNow(list: Item[]) {
    setMsg("");
    const ok = list.filter((i) => i.approved);
    if (!ok.length) {
      setMsg("Select approved clients first (only clients approved this cycle can be contacted).");
      return;
    }
    const who = askName();
    if (!who) return;
    if (
      !window.confirm(
        `Contact now ${ok.length} approved client(s)?\n\n${ok.map((i) => "- " + i.client_name).join("\n")}\n\nEach gets a fresh statement (email, or Viber with SMS fallback) and a call from Grace.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/contact-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_by: who,
          names: ok.slice(0, 20).map((i) => i.client_name),
        }),
      });
      const out = (await r.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        detail?: string;
      };
      if (!r.ok) throw new Error(out.detail || out.error || "Starting the contact failed");
      setMsg("Started. " + (out.reply || "Results will appear on the Notifications page."));
      await qc.invalidateQueries({ queryKey: ["contact-approvals"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function approveAndContact(list: Item[]) {
    setMsg("");
    if (!list.length) return;
    const who = askName();
    if (!who) return;
    if (
      !window.confirm(
        `Approve and contact now ${list.length} account(s) with 5+ branches?\n\n${list.map((i) => "- " + i.client_name).join("\n")}\n\nEach gets its statement (email / Viber, SMS fallback) and a call from Grace now.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r1 = await fetch("/api/contact-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved_by: who,
          items: list.map((i) => ({
            client_id: i.client_id,
            client_name: i.client_name,
            approved: true,
            allow_multibranch: true,
            note: "5+ branches: approved by AR for contact",
          })),
        }),
      });
      if (!r1.ok) throw new Error("Saving the approval failed");
      const r2 = await fetch("/api/contact-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requested_by: who, names: list.map((i) => i.client_name) }),
      });
      const out = (await r2.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        detail?: string;
      };
      if (!r2.ok) throw new Error(out.detail || out.error || "Starting the contact failed");
      setSelectedMulti(new Set());
      setMsg("Started. " + (out.reply || "Results will appear on the Notifications page."));
      await qc.invalidateQueries({ queryKey: ["contact-approvals"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(list: Item[], approve: boolean) {
    setMsg("");
    if (!list.length) return;
    const who = askName();
    if (!who) return;
    let note = "";
    if (!approve) {
      const n = window.prompt(
        "Why remove the approval? (optional, e.g. 'payment plan agreed, do not contact')",
        "",
      );
      if (n === null) return;
      note = n;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/contact-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved_by: who,
          items: list.map((i) => ({
            client_id: i.client_id,
            client_name: i.client_name,
            approved: approve,
            note,
          })),
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(b.detail || b.error || "Save failed");
      }
      setSelected(new Set());
      setMsg(`${approve ? "Approved" : "Approval removed for"} ${list.length} client(s).`);
      await qc.invalidateQueries({ queryKey: ["contact-approvals"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.client_id));
  const selectedItems = items.filter((i) => selected.has(i.client_id));
  const control =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <AppShell
      title="Contact Approvals"
      subtitle="Accounting approves which clients may be texted and called this cycle (Wed to Tue) · applies to /call and the automation"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      {weeklyAt ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <span>
            <span className="text-muted-foreground">Invoices from Zoho as of </span>
            <span className="font-semibold">
              {new Date(weeklyAt).toLocaleString("en-PH", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">This cycle: </span>
            <span className="font-semibold">
              {cycleDay(cycleStartMs)} – {cycleDay(cycleStartMs + 6 * 86400000)}
            </span>
          </span>
          {refreshedSince ? (
            <span className="text-muted-foreground">
              {refreshedSince} client(s) refreshed since (contacted, or on their collection day)
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Pending approval"
          value={String(pending.length)}
          hint={peso(pending.reduce((t, i) => t + i.total, 0)) + " outstanding"}
          tone="primary"
          onClick={() => setStatus("PENDING")}
          active={status === "PENDING"}
        />
        <StatCard
          label="Approved to contact"
          value={String(approved.length)}
          hint={peso(approved.reduce((t, i) => t + i.total, 0)) + " outstanding"}
          onClick={() => setStatus("APPROVED")}
          active={status === "APPROVED"}
        />
        <StatCard
          label="All clients with unpaid invoices"
          value={String(items.length)}
          onClick={() => setStatus("ALL")}
          active={status === "ALL"}
        />
      </div>

      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search client, contact, phone, sales person…"
          className={`${control} min-w-[220px] flex-1`}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className={control}
          aria-label="Status"
        >
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="ALL">All</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />{" "}
          Overdue only
        </label>
        <button
          type="button"
          disabled={busy || !selectedItems.length}
          onClick={() => save(selectedItems, true)}
          className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Approve selected ({selectedItems.length})
        </button>
        <button
          type="button"
          disabled={busy || !selectedItems.length}
          onClick={() => save(selectedItems, false)}
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-40"
        >
          Remove approval
        </button>
        <button
          type="button"
          disabled={busy || !selected.size}
          onClick={() => contactNow(items.filter((i) => selected.has(i.client_id)))}
          className="h-9 rounded-lg border border-primary px-3 text-sm font-semibold text-primary disabled:opacity-40"
        >
          Contact selected now
        </button>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "contact-approvals",
              [
                "Client",
                "Parent",
                "Contact",
                "Phone",
                "Email",
                "Overdue",
                "Current",
                "Total",
                "Invoices",
                "Account owner",
                "Approved",
                "Approved by",
                "Approved at",
                "Note",
              ],
              visible.map((i) => [
                i.client_name,
                i.parent_name,
                i.contact_person,
                i.phone,
                i.email,
                i.overdue,
                i.current,
                i.total,
                i.invoices.map((v) => v.number).join(" "),
                ownerName(i.ar_owner),
                i.approved ? "Yes" : "No",
                i.approved_by,
                i.approved_at,
                i.approval_note,
              ]),
            )
          }
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
        >
          Export CSV
        </button>
      </div>
      {msg ? <p className="mt-2 text-sm">{msg}</p> : null}

      <div className="mt-5">
        <div className="mb-3 flex gap-2">
          {(
            [
              ["OVERDUE", `Overdue (${overdueCount})`],
              ["CURRENT", `Current only (${currentOnlyCount})`],
              ["OTHER", `Other accounts (${otherCount})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${kind === k ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-muted"}`}
            >
              {label}
            </button>
          ))}
          {kind === "CURRENT" ? (
            <span className="self-center text-xs text-muted-foreground">
              Clients with invoices not yet due: decide whether to contact them this cycle.
            </span>
          ) : null}
        </div>
        {kind === "OTHER" ? (
          <OtherAccountsContent />
        ) : (
          <Panel
            title="Clients"
            description={`${visible.length} shown · only approved clients are texted or called (by /call or the automation)`}
          >
            {isLoading ? <SkeletonRows /> : null}
            {error ? (
              <p className="px-4 py-6 text-sm text-destructive">Could not load clients.</p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={allVisibleSelected}
                        onChange={() =>
                          setSelected(
                            allVisibleSelected
                              ? new Set()
                              : new Set(visible.map((i) => i.client_id)),
                          )
                        }
                      />
                    </th>
                    <th className="px-3 py-2.5 font-semibold">Client</th>
                    <th className="px-3 py-2.5 font-semibold">Contact</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Overdue</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Current</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                    <th className="px-3 py-2.5 font-semibold">Approval</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((i) => (
                    <Fragment key={i.client_id}>
                      <tr className={i.approved ? "" : "bg-warning/5"}>
                        <td className="px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Select ${i.client_name}`}
                            checked={selected.has(i.client_id)}
                            onChange={() => toggle(i.client_id)}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <a
                            href={`/clients/${encodeURIComponent(i.client_id)}`}
                            className="font-semibold hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {i.client_name}
                          </a>
                          <p className="text-xs text-muted-foreground">
                            {[
                              i.parent_name !== i.client_name ? i.parent_name : "",
                              i.segment,
                              i.ar_owner && `Account Owner: ${ownerName(i.ar_owner)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <ScheduleLine value={i.collection_schedule} />
                          <CreditLine terms={i.credit_terms} limit={i.credit_limit} />
                          <div className="mt-1 flex flex-wrap gap-1">
                            {future(i.promise_until) ? (
                              <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                                Promise until {day(i.promise_until)}
                              </span>
                            ) : null}
                            {future(i.ar_handoff_until) ? (
                              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                                AR handling until {day(i.ar_handoff_until)}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => setOpen(open === i.client_id ? null : i.client_id)}
                              className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold hover:bg-muted"
                            >
                              {open === i.client_id
                                ? "Hide invoices"
                                : `Show ${i.invoices.length} invoice(s)`}
                            </button>
                          </div>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Data from Zoho: {when(i.refreshed_at)}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top text-xs">
                          <p className="font-semibold">
                            {i.contact_person || (
                              <span className="text-destructive">No contact person</span>
                            )}
                          </p>
                          <p>{i.phone || <span className="text-destructive">No phone</span>}</p>
                          <p className="truncate">
                            {i.email || <span className="text-muted-foreground">No email</span>}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-right align-top tabular-nums font-semibold text-destructive">
                          {i.overdue ? peso(i.overdue) : "–"}
                        </td>
                        <td className="px-3 py-3 text-right align-top tabular-nums">
                          {i.current ? peso(i.current) : "–"}
                        </td>
                        <td className="px-3 py-3 text-right align-top tabular-nums font-semibold">
                          {peso(i.total)}
                        </td>
                        <td className="px-3 py-3 align-top">
                          {i.approved ? (
                            <>
                              <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                                Approved
                              </span>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {i.approved_by} · {when(i.approved_at)}
                              </p>
                              <CycleStatus i={i} />
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => save([i], false)}
                                className="mt-1 rounded-md border border-border px-2 py-0.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[11px] font-semibold text-warning">
                                Pending
                              </span>
                              {i.approval_expired ? (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Approved last cycle{i.approved_by ? ` by ${i.approved_by}` : ""}:
                                  approve again for this cycle
                                </p>
                              ) : null}
                              <CycleStatus i={i} />
                              {i.approval_note ? (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Note: {i.approval_note}
                                </p>
                              ) : null}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => save([i], true)}
                                className="mt-1 block rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                              >
                                Approve
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {open === i.client_id ? (
                        <tr>
                          <td />
                          <td colSpan={6} className="px-3 pb-4">
                            <InvoiceTable invoices={i.invoices} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  {!isLoading && visible.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-sm text-muted-foreground"
                      >
                        Nothing here.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <Pager
              total={visible.length}
              page={page}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSize}
            />
          </Panel>
        )}
      </div>

      <div className="mt-5">
        <Panel
          title={`Not contacted: 5+ branches (${multibranch.length})`}
          description="Not texted or called automatically. AR can choose to contact one or several: tick them and click 'Approve & contact selected', or 'Approve & contact now' on a row."
        >
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
            <button
              type="button"
              disabled={busy || !selectedMulti.size}
              onClick={() =>
                approveAndContact(multibranch.filter((i) => selectedMulti.has(i.client_id)))
              }
              className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              Approve &amp; contact selected ({selectedMulti.size})
            </button>
            <span className="text-xs text-muted-foreground">
              One statement and one call per contact, covering all its branches. Results appear on
              the Notifications page.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2.5"></th>
                  <th className="px-3 py-2.5 font-semibold">Client</th>
                  <th className="px-3 py-2.5 font-semibold">Contact</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Branches</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Overdue</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {multibranch.map((i) => (
                  <Fragment key={i.client_id}>
                    <tr>
                      <td className="px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${i.client_name}`}
                          checked={selectedMulti.has(i.client_id)}
                          onChange={() =>
                            setSelectedMulti((prev) => {
                              const n = new Set(prev);
                              if (n.has(i.client_id)) n.delete(i.client_id);
                              else n.add(i.client_id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-3">
                        <a
                          href={`/clients/${encodeURIComponent(i.client_id)}`}
                          className="font-semibold hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {i.client_name}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          {[i.ar_owner && `Account Owner: ${ownerName(i.ar_owner)}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <ScheduleLine value={i.collection_schedule} />
                        <CreditLine terms={i.credit_terms} limit={i.credit_limit} />

                        <div className="mt-1">
                          <InvoiceToggle
                            count={i.invoices.length}
                            open={openMulti === i.client_id}
                            onToggle={() =>
                              setOpenMulti(openMulti === i.client_id ? null : i.client_id)
                            }
                          />
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Data from Zoho: {when(i.refreshed_at)}
                        </p>
                      </td>
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
                      <td className="px-3 py-3">
                        {i.approved && i.allow_multibranch ? (
                          <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                            Approved for contact
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold">
                            Not called: AR handles manually
                          </span>
                        )}
                        <CycleStatus i={i} />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => approveAndContact([i])}
                          className="mt-1 block rounded-md border border-border px-2 py-0.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          Approve &amp; contact now
                        </button>
                      </td>
                    </tr>
                    {openMulti === i.client_id ? (
                      <tr>
                        <td />
                        <td colSpan={6} className="px-3 pb-4">
                          <InvoiceTable invoices={i.invoices} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                {multibranch.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      None.
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

/** What has happened with this client in the current cycle (texts and calls via /call or the automation). */
function CycleStatus({ i }: { i: Item }) {
  const t = (v: string) =>
    v
      ? new Date(v).toLocaleString("en-PH", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "";
  const ch = (c: string) =>
    c === "SMS" ? "SMS" : c === "VIBER" ? "Viber" : c === "WHATSAPP" ? "WhatsApp" : "Email";
  const tone: Record<string, string> = {
    Answered: "text-success",
    "Retry pending": "text-warning",
    "In progress": "text-warning",
    "Not reached": "text-destructive",
    "No answer": "text-destructive",
  };
  if (!i.text_this_cycle && !i.call_this_cycle)
    return <p className="mt-1 text-[11px] text-muted-foreground">Not contacted yet this cycle</p>;
  return (
    <div className="mt-1 space-y-0.5 text-[11px]">
      {i.text_this_cycle ? (
        <p>
          <span className="font-semibold">Text sent</span> · {ch(i.last_text_channel)} ·{" "}
          {t(i.last_text_at)}
          <span className="text-muted-foreground"> · {i.last_text_source}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">No text this cycle</p>
      )}
      {i.call_this_cycle ? (
        <p>
          <span className="font-semibold">Called</span> · {t(i.last_call_at)}{" "}
          <span className={`font-semibold ${tone[i.last_call_result] ?? ""}`}>
            {i.last_call_result}
          </span>
          {i.next_retry_at ? (
            <span className="text-muted-foreground">
              {" "}
              · next attempt {nextAttemptLabel(i.next_retry_at)}
            </span>
          ) : null}
          <span className="text-muted-foreground"> · {i.last_call_source}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">Not called this cycle</p>
      )}
    </div>
  );
}
