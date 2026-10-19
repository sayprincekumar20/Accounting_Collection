import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";
import { RefTag } from "@/components/collections/LogCells";
import { downloadCsv } from "@/lib/csv";

export const Route = createFileRoute("/worklist")({
  head: () => ({ meta: [{ title: "AR Worklist | Rare Global Food Collections" }] }),
  component: WorklistPage,
});

interface Item {
  entry_id: string;
  client_id: string;
  client_name: string;
  contact_person: string;
  email: string;
  phone: string;
  ar_owner: string;
  sales_person: string;
  balance: number;
  channel: string;
  reason: string;
  ref: string;
  recorded_at: string;
  status: "OPEN" | "IN_PROGRESS" | "DONE";
  handled_by: string;
  handled_at: string;
  ar_note: string;
}

const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (v: string) =>
  v
    ? new Date(v).toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};
const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-destructive/12 text-destructive",
  IN_PROGRESS: "bg-warning/15 text-warning",
  DONE: "bg-success/12 text-success",
};

function WorklistPage() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["worklist"],
    queryFn: async () => {
      const r = await fetch("/api/worklist");
      if (!r.ok) throw new Error("Worklist fetch failed");
      return ((await r.json()).items ?? []) as Item[];
    },
    refetchInterval: 300000,
  });
  const items = data ?? [];
  const [status, setStatus] = useState<"ALL" | Item["status"]>("OPEN");
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState("ALL");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    try {
      setName(sessionStorage.getItem("rgf-handler-name") || "");
    } catch {
      // ignore
    }
  }, []);
  const saveName = (v: string) => {
    setName(v);
    try {
      sessionStorage.setItem("rgf-handler-name", v);
    } catch {
      // ignore
    }
  };

  const count = (st: Item["status"]) => items.filter((i) => i.status === st).length;
  const visible = items.filter(
    (i) =>
      (status === "ALL" || i.status === status) &&
      (channel === "ALL" || i.channel === channel) &&
      (!q ||
        `${i.client_name} ${i.contact_person} ${i.reason} ${i.ref} ${i.ar_owner} ${i.handled_by}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );

  async function update(item: Item, next: Item["status"]) {
    setErr("");
    let who = name.trim();
    if (!who) {
      // Ask once; remembered for this browser session.
      const entered = window.prompt("Your name (shown as 'handled by'):", "");
      if (entered === null || !entered.trim()) return;
      who = entered.trim();
      saveName(who);
    }
    let note = item.ar_note;
    if (next === "DONE") {
      const n = window.prompt(
        "What was done? (optional note, e.g. 'Sent invoice copy 70467 by email')",
        item.ar_note || "",
      );
      if (n === null) return;
      note = n;
    }
    setBusy(item.entry_id);
    try {
      const r = await fetch("/api/worklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: item.entry_id,
          status: next,
          handled_by: name.trim(),
          note,
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(b.detail || b.error || "Update failed");
      }
      await qc.invalidateQueries({ queryKey: ["worklist"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  const select =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <AppShell
      title="AR Worklist"
      subtitle="Everything the AI agents and Grace escalated to the AR team · mark each one in progress or done"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {(["OPEN", "IN_PROGRESS", "DONE"] as const).map((st) => (
          <StatCard
            key={st}
            label={STATUS_LABEL[st] ?? st}
            value={String(count(st))}
            tone={st === "OPEN" ? "primary" : "default"}
            onClick={() => setStatus(status === st ? "ALL" : st)}
            active={status === st}
          />
        ))}
      </div>

      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search client, reason, Ref, AR owner…"
          className={`${select} min-w-[220px] flex-1`}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className={select}
          aria-label="Status"
        >
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="DONE">Done</option>
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className={select}
          aria-label="Channel"
        >
          <option value="ALL">All channels</option>
          <option value="EMAIL">Email</option>
          <option value="SMS">SMS</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="VOICE">Voice</option>
        </select>
        <input
          value={name}
          onChange={(e) => saveName(e.target.value)}
          placeholder="Your name (for 'handled by')"
          className={`${select} w-56`}
          aria-label="Your name"
        />
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              "ar-worklist",
              [
                "Escalated at",
                "Client",
                "Contact",
                "Phone",
                "Email",
                "AR owner",
                "Sales person",
                "Balance",
                "Channel",
                "Reason",
                "Ref",
                "Status",
                "Handled by",
                "Handled at",
                "AR note",
              ],
              visible.map((i) => [
                i.recorded_at,
                i.client_name,
                i.contact_person,
                i.phone,
                i.email,
                i.ar_owner,
                i.sales_person,
                i.balance,
                i.channel,
                i.reason,
                i.ref,
                STATUS_LABEL[i.status],
                i.handled_by,
                i.handled_at,
                i.ar_note,
              ]),
            )
          }
          className="h-9 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
        >
          Export CSV
        </button>
      </div>
      {err ? <p className="mt-2 text-sm text-destructive">{err}</p> : null}

      <div className="mt-5">
        <Panel title="Escalations" description={`${visible.length} shown · newest first`}>
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">Could not load the worklist.</p>
          ) : null}
          <ul className="divide-y divide-border">
            {visible.map((i) => (
              <li key={i.entry_id} className="grid gap-3 px-4 py-3 lg:grid-cols-[1.2fr_2fr_1fr]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{i.client_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[i.contact_person, i.phone, i.email].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {peso(i.balance)} {i.ar_owner ? `· AR ${i.ar_owner}` : ""}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {i.channel} · {when(i.recorded_at)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-sm">{i.reason}</p>
                  <RefTag refId={i.ref} className="mt-1" />
                  {i.ar_note ? (
                    <p className="mt-1 text-xs text-muted-foreground">AR note: {i.ar_note}</p>
                  ) : null}
                </div>
                <div className="flex flex-col items-start gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[i.status]}`}
                  >
                    {STATUS_LABEL[i.status]}
                  </span>
                  {i.handled_by ? (
                    <span className="text-[11px] text-muted-foreground">
                      {i.handled_by} · {when(i.handled_at)}
                    </span>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {i.status === "OPEN" ? (
                      <button
                        type="button"
                        disabled={busy === i.entry_id}
                        onClick={() => update(i, "IN_PROGRESS")}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                      >
                        Start
                      </button>
                    ) : null}
                    {i.status !== "DONE" ? (
                      <button
                        type="button"
                        disabled={busy === i.entry_id}
                        onClick={() => update(i, "DONE")}
                        className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        Done
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === i.entry_id}
                        onClick={() => update(i, "OPEN")}
                        className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
            {!isLoading && visible.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing here.</li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}
