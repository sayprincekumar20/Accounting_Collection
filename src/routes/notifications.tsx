import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SkeletonRows } from "@/components/collections/Skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IssueTools } from "@/components/collections/IssueTools";
import { Pager, usePaged } from "@/components/collections/Pager";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";

// System notifications now live in the Escalations module, in their own tab (kept apart from customer
// escalations). This address stays as a redirect so old links keep working.
export const Route = createFileRoute("/notifications")({
  beforeLoad: () => {
    throw redirect({ href: "/escalations?tab=system" });
  },
});

interface Item {
  id: string;
  at: string;
  kind: string;
  title: string;
  summary: string;
  message: string;
  ref?: string;
  status?: "OPEN" | "IN_PROGRESS" | "DONE";
  handled_by?: string;
  ar_note?: string;
}
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
/** Workflow failures need someone to act (status, diagnosis); the other notifications are information. */
const actionable = (i: Item) => i.kind === "Error";
const KINDS = ["All", "Error", "/call result", "Cycle close-out", "System"];
const when = (v: string) =>
  v
    ? new Date(v).toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const tone: Record<string, string> = {
  Error: "bg-destructive/15 text-destructive",
  "/call result": "bg-secondary text-secondary-foreground",
  "Cycle close-out": "bg-warning/15 text-warning",
  Callback: "bg-success/12 text-success",
  System: "bg-muted text-muted-foreground",
};

/** System messages that used to be posted to Zoho Cliq #sales (Cliq notifications are switched off). */
export function NotificationsContent() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [actErr, setActErr] = useState("");
  async function setStatus(i: Item, next: "IN_PROGRESS" | "DONE" | "OPEN") {
    setActErr("");
    let who = "";
    try {
      who = sessionStorage.getItem("rgf-handler-name") || "";
    } catch {
      who = "";
    }
    if (!who) {
      const entered = window.prompt("Your name (shown as 'handled by'):", "");
      if (entered === null || !entered.trim()) return;
      who = entered.trim();
      try {
        sessionStorage.setItem("rgf-handler-name", who);
      } catch {
        // ignore
      }
    }
    let note = i.ar_note ?? "";
    if (next === "DONE") {
      const n = window.prompt(
        "What fixed it? (the resolution, e.g. 'Drive credential reconnected, run repeated')",
        note,
      );
      if (n === null) return;
      if (!n.trim()) {
        setActErr("Please give the resolution to mark it Done.");
        return;
      }
      note = n.trim();
    }
    setBusy(i.id);
    try {
      const r = await fetch("/api/worklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: i.id,
          status: next,
          handled_by: who,
          note,
          issue_kind: "SYSTEM",
          ref: i.ref ?? "",
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { detail?: string; error?: string };
        throw new Error(b.error || b.detail || "Update failed");
      }
      await qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      setActErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const r = await fetch("/api/notifications");
      if (!r.ok) throw new Error("Fetch failed");
      return ((await r.json()).items ?? []) as Item[];
    },
    refetchInterval: 120000,
  });
  const items = useMemo(() => data ?? [], [data]);
  const [kind, setKind] = useState("All");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [statusF, setStatusF] = useState<"ALL" | "OPEN" | "IN_PROGRESS" | "DONE">("ALL");
  const visible = items.filter(
    (i) =>
      (kind === "All" || i.kind === kind) &&
      // a status applies to workflow failures (information notices have none)
      (statusF === "ALL" || (actionable(i) && (i.status ?? "OPEN") === statusF)) &&
      (!q || `${i.title} ${i.summary} ${i.message}`.toLowerCase().includes(q.toLowerCase())),
  );
  const { paged, pager } = usePaged(visible);
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const todayCount = items.filter(
    (i) => new Date(new Date(i.at).getTime() + 8 * 3600000).toISOString().slice(0, 10) === today,
  ).length;
  const control =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <>
      <div className="mb-4 flex justify-end">
        <RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Today" value={String(todayCount)} tone="primary" />
        <StatCard
          label="Open failures"
          value={String(items.filter((i) => actionable(i) && i.status !== "DONE").length)}
          onClick={() => setKind("Error")}
          active={kind === "Error"}
        />
        <StatCard
          label="All notifications"
          value={String(items.length)}
          onClick={() => setKind("All")}
          active={kind === "All"}
        />
      </div>
      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search notifications…"
          className={`${control} min-w-[220px] flex-1`}
        />
        <select
          value={statusF}
          aria-label="Status"
          onChange={(e) => {
            setStatusF(e.target.value as typeof statusF);
          }}
          className={control}
        >
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="DONE">Done</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={control}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-5">
        <Panel title="System notifications" description={`${visible.length} shown · newest first`}>
          {actErr ? <p className="px-4 pt-2 text-xs text-destructive">{actErr}</p> : null}
          {isLoading ? <SkeletonRows /> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">Could not load notifications.</p>
          ) : null}
          <ul className="divide-y divide-border">
            {paged.map((i) => (
              <li key={i.id + i.at} className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(open === i.id ? null : i.id)}
                  className="w-full text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone[i.kind] ?? tone["System"]}`}
                    >
                      {i.kind}
                    </span>
                    <span className="text-sm font-semibold">{i.title}</span>
                    {actionable(i) && i.status ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[i.status]}`}
                      >
                        {STATUS_LABEL[i.status]}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">{when(i.at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{i.summary}</p>
                </button>
                {open === i.id ? (
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
                    {i.message}
                  </pre>
                ) : null}
                {actionable(i) ? (
                  <div className="mt-1.5 flex flex-wrap items-start gap-x-3 gap-y-1">
                    <IssueTools issueId={i.id} issueRef={i.ref ?? ""} kind="SYSTEM" />
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {i.status === "OPEN" ? (
                        <button
                          type="button"
                          disabled={busy === i.id}
                          onClick={() => void setStatus(i, "IN_PROGRESS")}
                          className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          Mark in progress
                        </button>
                      ) : null}
                      {i.status !== "DONE" ? (
                        <button
                          type="button"
                          disabled={busy === i.id}
                          onClick={() => void setStatus(i, "DONE")}
                          className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          Done…
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === i.id}
                          onClick={() => void setStatus(i, "OPEN")}
                          className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      )}
                      {i.handled_by ? (
                        <span className="text-[11px] text-muted-foreground">
                          {i.handled_by}
                          {i.ar_note ? ` · ${i.ar_note}` : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
            {!isLoading && visible.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications.
              </li>
            ) : null}
          </ul>
          <Pager {...pager} />
        </Panel>
      </div>
    </>
  );
}
