import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, StatCard, RefreshButton } from "@/components/collections/Bits";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications | Rare Global Food Collections" }] }),
  component: NotificationsPage,
});

interface Item {
  id: string;
  at: string;
  kind: string;
  title: string;
  summary: string;
  message: string;
}
const KINDS = ["All", "Error", "/call result", "Cycle close-out", "Callback", "System"];
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
function NotificationsPage() {
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
  const visible = items.filter(
    (i) =>
      (kind === "All" || i.kind === kind) &&
      (!q || `${i.title} ${i.summary} ${i.message}`.toLowerCase().includes(q.toLowerCase())),
  );
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const todayCount = items.filter(
    (i) => new Date(new Date(i.at).getTime() + 8 * 3600000).toISOString().slice(0, 10) === today,
  ).length;
  const control =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <AppShell
      title="Notifications"
      subtitle="System messages: errors, /call results, cycle close-out, client callbacks (previously posted to Zoho Cliq)"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Today" value={String(todayCount)} tone="primary" />
        <StatCard
          label="Errors"
          value={String(items.filter((i) => i.kind === "Error").length)}
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
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={control}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-5">
        <Panel title="Notifications" description={`${visible.length} shown · newest first`}>
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">Could not load notifications.</p>
          ) : null}
          <ul className="divide-y divide-border">
            {visible.map((i) => (
              <li key={i.id + i.at} className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setOpen(open === i.id ? null : i.id)}
                  className="w-full text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone[i.kind] ?? tone.System}`}
                    >
                      {i.kind}
                    </span>
                    <span className="text-sm font-semibold">{i.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{when(i.at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{i.summary}</p>
                </button>
                {open === i.id ? (
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
                    {i.message}
                  </pre>
                ) : null}
              </li>
            ))}
            {!isLoading && visible.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications.
              </li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}
