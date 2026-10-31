import { Fragment, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";
import { downloadCsv } from "@/lib/csv";

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
  const items = useMemo(() => data ?? [], [data]);
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "ALL">("PENDING");
  const [overdueOnly, setOverdueOnly] = useState(false);
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
      (status === "ALL" || (status === "APPROVED" ? i.approved : !i.approved)) &&
      (!overdueOnly || i.overdue > 0) &&
      (!q ||
        `${i.client_name} ${i.parent_name} ${i.contact_person} ${i.phone} ${i.email} ${i.sales_person} ${i.ar_owner}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
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
      subtitle="Accounting approves which clients may be texted and called · applies to /call and the automation"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
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
                "Sales person",
                "AR owner",
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
                i.sales_person,
                i.ar_owner,
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
        <Panel
          title="Clients"
          description={`${visible.length} shown · only approved clients are texted or called (by /call or the automation)`}
        >
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
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
                          allVisibleSelected ? new Set() : new Set(visible.map((i) => i.client_id)),
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
                {visible.map((i) => (
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
                        <p className="font-semibold">{i.client_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            i.parent_name !== i.client_name ? i.parent_name : "",
                            i.segment,
                            i.sales_person && `Sales: ${i.sales_person}`,
                            i.ar_owner && `AR: ${i.ar_owner}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
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
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="py-1 pr-3">Invoice</th>
                                <th className="py-1 pr-3">Branch</th>
                                <th className="py-1 pr-3">Date</th>
                                <th className="py-1 pr-3">Due date</th>
                                <th className="py-1 pr-3 text-right">Amount</th>
                                <th className="py-1 pr-3 text-right">Balance</th>
                                <th className="py-1 pr-3">Status</th>
                                <th className="py-1">PO</th>
                              </tr>
                            </thead>
                            <tbody>
                              {i.invoices.map((v, k) => (
                                <tr key={k} className="border-t border-border">
                                  <td className="py-1 pr-3 font-semibold">{v.number}</td>
                                  <td className="py-1 pr-3">{v.branch}</td>
                                  <td className="py-1 pr-3">{day(v.date)}</td>
                                  <td className="py-1 pr-3">{day(v.due)}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">
                                    {peso(v.amount)}
                                  </td>
                                  <td className="py-1 pr-3 text-right tabular-nums">
                                    {peso(v.balance)}
                                  </td>
                                  <td
                                    className={`py-1 pr-3 font-semibold ${v.status === "OVERDUE" ? "text-destructive" : ""}`}
                                  >
                                    {v.status || "–"}
                                  </td>
                                  <td className="py-1">{v.po || "–"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                {!isLoading && visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
