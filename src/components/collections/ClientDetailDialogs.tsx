import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

// Clickable 'Escalated' and 'Promised' badges: open the client's full escalation / promise details.
const companyKey = (id: unknown) =>
  String(id ?? "")
    .split("___")[0]!
    .trim()
    .toLowerCase();
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
const day = (v: string) =>
  v
    ? new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "";

interface WorkItem {
  entry_id: string;
  client_id: string;
  client_name?: string;
  channel: string;
  reason: string;
  ref: string;
  status: string;
  handled_by: string;
  ar_note: string;
  timestamp?: string;
  recorded_at?: string;
  handled_at?: string;
}
interface PromiseItem {
  client_id: string;
  client_name: string;
  promise_date: string;
  state: string;
  channel?: string;
  recorded_at?: string;
  timestamp?: string;
  reason?: string;
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-bold">{title}</p>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-destructive/12 text-destructive",
  IN_PROGRESS: "bg-warning/15 text-warning",
  DONE: "bg-success/12 text-success",
};
const STATE_TONE: Record<string, string> = {
  BROKEN: "bg-destructive/12 text-destructive",
  DUE_TODAY: "bg-warning/15 text-warning",
  UPCOMING: "bg-secondary text-secondary-foreground",
  KEPT: "bg-success/12 text-success",
};

/** 'Escalated' badge: click to see every escalation of this client (Ref, status, full reason, AR note). */
export function EscalationBadge({
  clientId,
  clientName,
  label,
  className,
}: {
  clientId: string;
  clientName?: string;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["worklist"],
    queryFn: async () => {
      const r = await fetch("/api/worklist");
      if (!r.ok) throw new Error("Fetch failed");
      const j = (await r.json()) as { items?: WorkItem[]; entries?: WorkItem[] };
      return (j.items ?? j.entries ?? []) as WorkItem[];
    },
    enabled: open,
  });
  const k = companyKey(clientId);
  const mine = (data ?? [])
    .filter((e) => companyKey(e.client_id) === k)
    .sort((a, b) =>
      String(b.timestamp ?? b.recorded_at ?? "").localeCompare(
        String(a.timestamp ?? a.recorded_at ?? ""),
      ),
    );
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Show escalation details"
        className={
          className ??
          "max-w-[260px] truncate rounded-full bg-destructive/12 px-2.5 py-0.5 text-[11px] font-semibold text-destructive underline-offset-2 hover:underline"
        }
      >
        {label}
      </button>
      {open ? (
        <Modal
          title={`Escalations · ${clientName || k}`}
          subtitle="Raised by the AI agents and Grace for the AR team"
          onClose={() => setOpen(false)}
        >
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!isLoading && !mine.length ? (
            <p className="text-sm text-muted-foreground">No escalations found for this client.</p>
          ) : null}
          <ul className="space-y-3">
            {mine.map((e) => (
              <li key={e.entry_id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {e.ref ? (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono font-semibold">
                      Ref {e.ref}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[e.status] ?? STATUS_TONE["OPEN"]}`}
                  >
                    {(e.status || "OPEN").replace("_", " ")}
                  </span>
                  <span className="text-muted-foreground">{e.channel}</span>
                  <span className="ml-auto text-muted-foreground">
                    {when(e.timestamp ?? e.recorded_at ?? "")}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{e.reason}</p>
                {e.handled_by || e.ar_note ? (
                  <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                    {e.handled_by ? <span className="font-semibold">{e.handled_by}: </span> : null}
                    {e.ar_note || "handling"}
                  </p>
                ) : null}
                <a
                  href={`/worklist?q=${encodeURIComponent(e.ref || clientName || "")}`}
                  className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
                >
                  Open in AR Worklist →
                </a>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </>
  );
}

/** 'Promised' badge: click to see the client's promises (date, state, when and how they were made). */
export function PromiseBadge({
  clientId,
  clientName,
  label,
  className,
}: {
  clientId: string;
  clientName?: string;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["promises-board"],
    queryFn: async () => {
      const r = await fetch("/api/promises-board");
      if (!r.ok) throw new Error("Fetch failed");
      return ((await r.json()).items ?? []) as PromiseItem[];
    },
    enabled: open,
  });
  const k = companyKey(clientId);
  const mine = (data ?? []).filter((p) => companyKey(p.client_id) === k);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Show promise details"
        className={
          className ??
          "rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-semibold text-success underline-offset-2 hover:underline"
        }
      >
        {label}
      </button>
      {open ? (
        <Modal title={`Promise to pay · ${clientName || k}`} onClose={() => setOpen(false)}>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!isLoading && !mine.length ? (
            <p className="text-sm text-muted-foreground">No promise recorded for this client.</p>
          ) : null}
          <ul className="space-y-3">
            {mine.map((p, i) => (
              <li key={i} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-sm font-bold">Pay by {day(p.promise_date)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${STATE_TONE[p.state] ?? STATE_TONE["UPCOMING"]}`}
                  >
                    {String(p.state || "").replace("_", " ")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recorded {when(p.recorded_at ?? p.timestamp ?? "")}
                  {p.channel ? ` · via ${p.channel}` : ""}
                </p>
              </li>
            ))}
          </ul>
          <Link
            to="/promises"
            className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
          >
            Open Promises →
          </Link>
        </Modal>
      ) : null}
    </>
  );
}
