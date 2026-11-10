import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { escalationAgeHours, escalationType } from "@/lib/escalation-type";
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
  message?: string;
  type?: string;
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

interface Snapshot {
  found: boolean;
  client_id: string;
  client_name: string;
  contact_person: string;
  phone: string;
  email: string;
  ar_owner: string;
  credit_terms: string;
  credit_limit: number | null;
  collection_schedule: string;
  overdue: number;
  current: number;
  total: number;
  invoices: {
    branch: string;
    number: string;
    due: string;
    balance: number;
    status: string;
    counter: string;
  }[];
  approved_this_cycle: boolean;
  promise: { date: string; channel: string } | null;
  open_escalations: number;
  last_contact: {
    last_text_at: string;
    last_text_channel: string;
    last_call_at: string;
    last_call_result: string;
  };
}
const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const titleCase = (v: string) =>
  v
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
const CHANNEL_PAGE: Record<string, string> = {
  EMAIL: "/email",
  SMS: "/sms",
  VIBER: "/viber",
  WHATSAPP: "/whatsapp",
  VOICE: "/voice",
  VOICE_CALLBACK: "/voice",
};
const ageText = (h: number) =>
  h < 1 ? "under 1 hour" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;

function askHandler(): string {
  try {
    let n = sessionStorage.getItem("rgf-handler-name") || "";
    if (!n) {
      n = (window.prompt("Your name (saved with the update):", "") || "").trim();
      if (n) sessionStorage.setItem("rgf-handler-name", n);
    }
    return n;
  } catch {
    return "";
  }
}

function ClientContext({ snap }: { snap: Snapshot }) {
  const lc = snap.last_contact;
  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/40 p-3 text-xs">
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Contact:</span>{" "}
          <span className="font-semibold">{snap.contact_person || "–"}</span>
        </p>
        <p>
          <span className="text-muted-foreground">Account Owner:</span>{" "}
          {snap.ar_owner ? titleCase(snap.ar_owner) : "–"}
        </p>
        <p>
          <span className="text-muted-foreground">Phone:</span> {snap.phone || "–"}
        </p>
        <p className="truncate">
          <span className="text-muted-foreground">Email:</span> {snap.email || "–"}
        </p>
        <p>
          <span className="text-muted-foreground">Terms:</span> {snap.credit_terms || "not on file"}{" "}
          · <span className="text-muted-foreground">Limit:</span>{" "}
          {snap.credit_limit ? peso(snap.credit_limit) : "not on file"}
        </p>
        <p>
          <span className="text-muted-foreground">Collection schedule:</span>{" "}
          {snap.collection_schedule || "Not set"}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="rounded-full bg-destructive/12 px-2 py-0.5 font-semibold text-destructive">
          Overdue {peso(snap.overdue)}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
          Current {peso(snap.current)}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
          Total {peso(snap.total)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${snap.approved_this_cycle ? "bg-success/12 text-success" : "bg-warning/15 text-warning"}`}
        >
          {snap.approved_this_cycle ? "Approved this cycle" : "Not approved this cycle"}
        </span>
        {snap.promise ? (
          <span className="rounded-full bg-success/12 px-2 py-0.5 font-semibold text-success">
            Promise {day(snap.promise.date)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-muted-foreground">
        Last text: {lc.last_text_at ? `${lc.last_text_channel} · ${when(lc.last_text_at)}` : "none"}{" "}
        · Last call:{" "}
        {lc.last_call_at ? `${when(lc.last_call_at)} · ${lc.last_call_result}` : "none"}
      </p>
      {snap.invoices.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-2">Invoice</th>
                <th className="py-1 pr-2">Due</th>
                <th className="py-1 pr-2">Counter</th>
                <th className="py-1 pr-2 text-right">Balance</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {snap.invoices.slice(0, 8).map((v, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1 pr-2 font-semibold">{v.number}</td>
                  <td className="py-1 pr-2">{day(v.due)}</td>
                  <td className="py-1 pr-2">{v.counter ? day(v.counter) : "–"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{peso(v.balance)}</td>
                  <td
                    className={`py-1 font-semibold ${v.status === "OVERDUE" ? "text-destructive" : ""}`}
                  >
                    {v.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {snap.invoices.length > 8 ? (
            <p className="mt-1 text-muted-foreground">
              … and {snap.invoices.length - 8} more invoices
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 'Escalated' badge: opens the full escalation card (client context, what the client said, history, actions). */
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
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["worklist"],
    queryFn: async () => {
      const r = await fetch("/api/worklist");
      if (!r.ok) throw new Error("Fetch failed");
      const j = (await r.json()) as { items?: WorkItem[] };
      return (j.items ?? []) as WorkItem[];
    },
    enabled: open,
  });
  const { data: snap } = useQuery({
    queryKey: ["client-snapshot", clientId],
    queryFn: async () => {
      const r = await fetch(`/api/client-snapshot?client_id=${encodeURIComponent(clientId)}`);
      if (!r.ok) throw new Error("Fetch failed");
      return (await r.json()) as Snapshot;
    },
    enabled: open && !!clientId,
  });
  const k = companyKey(clientId);
  const mine = (data ?? [])
    .filter((e) => companyKey(e.client_id) === k)
    .sort((a, b) => String(b.recorded_at ?? "").localeCompare(String(a.recorded_at ?? "")));

  async function setStatus(e: WorkItem, status: "IN_PROGRESS" | "DONE" | "OPEN") {
    const who = askHandler();
    if (!who) return;
    const note =
      status === "DONE"
        ? (window.prompt("Note for the AR Worklist (what was done):", e.ar_note || "") ?? "")
        : e.ar_note || "";
    setBusy(e.entry_id);
    setMsg("");
    try {
      const r = await fetch("/api/worklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: e.entry_id, status, handled_by: who, note }),
      });
      if (!r.ok) throw new Error("Saving failed");
      await qc.invalidateQueries({ queryKey: ["worklist"] });
      setMsg(`Saved: ${e.ref ? "Ref " + e.ref : "escalation"} is now ${status.replace("_", " ")}.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Saving failed");
    } finally {
      setBusy("");
    }
  }

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
          title={`Escalations · ${clientName || snap?.client_name || k}`}
          subtitle="Raised by the AI agents and Grace for the AR team"
          onClose={() => setOpen(false)}
        >
          {snap?.found ? <ClientContext snap={snap} /> : null}
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <a
              href={`/clients/${encodeURIComponent(snap?.client_id || clientId)}`}
              className="rounded-lg border border-border px-2.5 py-1 font-semibold hover:bg-muted"
            >
              Open client page
            </a>
          </div>
          {msg ? <p className="mb-2 rounded-lg bg-muted px-3 py-1.5 text-xs">{msg}</p> : null}
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {!isLoading && !mine.length ? (
            <p className="text-sm text-muted-foreground">No escalations found for this client.</p>
          ) : null}
          <ul className="space-y-3">
            {mine.map((e) => {
              const h = escalationAgeHours(e.recorded_at ?? "", e.status, e.handled_at);
              const late = e.status !== "DONE" && h >= 48;
              const page = CHANNEL_PAGE[e.channel] ?? "/email";
              return (
                <li key={e.entry_id} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {e.ref ? (
                      <button
                        type="button"
                        title="Copy Ref"
                        onClick={() => void navigator.clipboard?.writeText(e.ref)}
                        className="rounded-md bg-muted px-1.5 py-0.5 font-mono font-semibold hover:bg-muted/70"
                      >
                        Ref {e.ref} ⧉
                      </button>
                    ) : null}
                    <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold text-secondary-foreground">
                      {e.type || escalationType(e.reason)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[e.status] ?? STATUS_TONE["OPEN"]}`}
                    >
                      {(e.status || "OPEN").replace("_", " ")}
                    </span>
                    <span
                      className={late ? "font-semibold text-destructive" : "text-muted-foreground"}
                    >
                      {e.status === "DONE" ? `handled in ${ageText(h)}` : `open ${ageText(h)}`}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {e.channel} · {when(e.recorded_at ?? "")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold">{e.reason}</p>
                  {e.message && e.message !== e.reason ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs font-semibold text-primary">
                        What the client said / full details
                      </summary>
                      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-xs">
                        {e.message}
                      </pre>
                    </details>
                  ) : null}
                  {e.handled_by || e.ar_note ? (
                    <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                      {e.handled_by ? <span className="font-semibold">{e.handled_by}</span> : null}
                      {e.handled_at ? (
                        <span className="text-muted-foreground"> · {when(e.handled_at)}</span>
                      ) : null}
                      {e.ar_note ? <span>: {e.ar_note}</span> : null}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {e.status === "OPEN" ? (
                      <button
                        type="button"
                        disabled={busy === e.entry_id}
                        onClick={() => void setStatus(e, "IN_PROGRESS")}
                        className="rounded-lg border border-border px-2.5 py-1 font-semibold hover:bg-muted disabled:opacity-50"
                      >
                        Start
                      </button>
                    ) : null}
                    {e.status !== "DONE" ? (
                      <button
                        type="button"
                        disabled={busy === e.entry_id}
                        onClick={() => void setStatus(e, "DONE")}
                        className="rounded-lg bg-primary px-2.5 py-1 font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Mark done
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === e.entry_id}
                        onClick={() => void setStatus(e, "OPEN")}
                        className="rounded-lg border border-border px-2.5 py-1 font-semibold hover:bg-muted disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}
                    <a
                      href={page}
                      className="rounded-lg border border-border px-2.5 py-1 font-semibold hover:bg-muted"
                    >
                      Reply on{" "}
                      {e.channel === "VOICE" || e.channel === "VOICE_CALLBACK"
                        ? "Voice"
                        : e.channel.charAt(0) + e.channel.slice(1).toLowerCase()}
                    </a>
                    <a
                      href={`/worklist?q=${encodeURIComponent(e.ref || clientName || "")}`}
                      className="rounded-lg border border-border px-2.5 py-1 font-semibold hover:bg-muted"
                    >
                      Open in AR Worklist
                    </a>
                  </div>
                </li>
              );
            })}
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
