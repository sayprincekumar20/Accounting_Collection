import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Panel } from "@/components/collections/Bits";
import type { BatchSummary, Cell, ClientOutcome } from "@/lib/batch-report";

// Reports > Approval batch reports: one report per AR approval action, with ONLY the clients approved in it and
// what happened to them after the approval (channels, fallback, calls, pick-up, replies, promise, escalation,
// collection). Batches are saved by n8n workflow 28 each time the AR team approves.

interface BatchItem {
  batch_id: string;
  approved_at: string;
  approved_by: string;
  source: string;
  note: string;
  label: string;
  balance_at_approval: number | null;
  summary: BatchSummary;
  outcomes: ClientOutcome[];
}

const MANILA = 8 * 3600000;
const dayKey = (iso: string) =>
  new Date(new Date(iso).getTime() + MANILA).toISOString().slice(0, 10);
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
const peso = (n: number) =>
  "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function outcomeTone(o: string) {
  if (o === "Fully paid" || o.startsWith("Partly paid")) return "bg-success/12 text-success";
  if (o.startsWith("Promise")) return "bg-primary/10 text-primary";
  if (o.startsWith("Escalated")) return "bg-destructive/12 text-destructive";
  if (o.startsWith("Approval removed") || o.startsWith("Not contacted"))
    return "bg-muted text-muted-foreground";
  return "bg-warning/18 text-warning";
}

async function downloadBatch(batchId: string) {
  const r = await fetch(`/api/approval-batch-report?batch_id=${encodeURIComponent(batchId)}`);
  const j = (await r.json().catch(() => ({}))) as {
    file_name?: string;
    sheets?: {
      name: string;
      rows: Cell[][];
      headerRow: number;
      boldRows: number;
      widths: number[];
    }[];
    error?: string;
  };
  if (!r.ok || !j.sheets) throw new Error(j.error || `Download failed (${r.status})`);
  const { buildXlsx } = await import("@/lib/xlsx-writer");
  const bytes = buildXlsx(j.sheets);
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = j.file_name || "Batch report.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function BatchReports() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["approval-batches"],
    queryFn: async () => {
      const r = await fetch("/api/approval-batches");
      const j = (await r.json().catch(() => ({}))) as { batches?: BatchItem[]; error?: string };
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      return j.batches ?? [];
    },
    refetchInterval: 300000,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const days = new Map<string, BatchItem[]>();
  for (const b of data ?? []) {
    const k = dayKey(b.approved_at);
    days.set(k, [...(days.get(k) ?? []), b]);
  }

  return (
    <Panel
      title="Approval batch reports"
      description="One report per AR approval: only the clients approved in that batch, and what happened to them after the approval."
    >
      {isLoading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading the approval batches…</p>
      ) : error ? (
        <p className="px-4 py-6 text-sm text-destructive">{(error as Error).message}</p>
      ) : !data?.length ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No approval batches yet. Each time the AR team approves clients, a batch report appears
          here.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {err ? <p className="px-4 py-2 text-xs text-destructive">{err}</p> : null}
          {[...days].map(([day, list]) => (
            <div key={day} className="px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {dayLabel(list[0]!.approved_at)} · {list.length} batch
                {list.length === 1 ? "" : "es"}
              </p>
              <div className="mt-2 space-y-2">
                {list.map((b) => {
                  const sm = b.summary;
                  const isOpen = open === b.batch_id;
                  return (
                    <div key={b.batch_id} className="rounded-xl border border-border">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                        <div className="min-w-[170px]">
                          <p className="text-sm font-semibold">
                            {time(b.approved_at)} · {sm.clients} client{sm.clients === 1 ? "" : "s"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Approved by {b.approved_by || "unknown"}
                            {b.source === "rebuilt" ? " · rebuilt from approval records" : ""}
                          </p>
                        </div>
                        <div className="flex flex-1 flex-wrap gap-1.5 text-[11px]">
                          {[
                            [`Texted ${sm.texted}`, ""],
                            [`Called ${sm.called} (picked up ${sm.picked_up})`, ""],
                            [`Replied ${sm.replied}`, ""],
                            [`Promise to pay ${sm.promised}`, "text-primary"],
                            [`Escalated ${sm.escalated}`, sm.escalated ? "text-destructive" : ""],
                            [
                              sm.collected == null
                                ? `Paid ${sm.paid}`
                                : `Paid ${sm.paid} · collected ${peso(sm.collected)}`,
                              sm.paid ? "text-success" : "",
                            ],
                            ...(sm.removed ? [[`Approval removed ${sm.removed}`, ""]] : []),
                          ].map(([t, tone]) => (
                            <span
                              key={t}
                              className={`rounded-full bg-muted px-2 py-0.5 font-semibold ${tone}`}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setOpen(isOpen ? null : b.batch_id)}
                            className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
                          >
                            {isOpen ? "Hide clients" : "Show clients"}
                          </button>
                          <button
                            type="button"
                            disabled={busy === b.batch_id}
                            onClick={async () => {
                              setBusy(b.batch_id);
                              setErr("");
                              try {
                                await downloadBatch(b.batch_id);
                              } catch (e) {
                                setErr(e instanceof Error ? e.message : "Download failed");
                              } finally {
                                setBusy(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                          >
                            {busy === b.batch_id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            Excel
                          </button>
                        </div>
                      </div>
                      {b.note && isOpen ? (
                        <p className="px-3 pb-2 text-[11px] text-muted-foreground">{b.note}</p>
                      ) : null}
                      {isOpen ? <BatchClients outcomes={b.outcomes} /> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function BatchClients({ outcomes }: { outcomes: ClientOutcome[] }) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full min-w-[1100px] text-xs">
        <thead className="bg-muted/50 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {[
              "Customer",
              "Channel (fallback)",
              "Text",
              "Calls",
              "Picked up",
              "Customer response",
              "Confirmation",
              "Promise",
              "Escalation",
              "Collection",
            ].map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {outcomes.map((o) => {
            const reply = o.replies[o.replies.length - 1];
            return (
              <tr key={o.client_id} className={o.removed_at ? "opacity-60" : ""}>
                <td className="px-3 py-2 font-semibold">{o.client_name}</td>
                <td className="px-3 py-2">
                  {o.channels_used.join(", ") || "—"}
                  {o.fallback ? (
                    <span className="block text-muted-foreground">fallback {o.fallback}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{o.text_status}</td>
                <td className="px-3 py-2">
                  {o.call_status}
                  {o.not_reached_alert ? (
                    <span className="block text-warning">Not reached (call + retry)</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{o.picked_up || "—"}</td>
                <td className="max-w-[220px] px-3 py-2">
                  {reply ? (
                    <span title={reply.text}>
                      {reply.channel}: {reply.text.slice(0, 80)}
                      {reply.text.length > 80 ? "…" : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-[200px] px-3 py-2">{o.confirmation}</td>
                <td className="px-3 py-2">{o.ptp_date || "—"}</td>
                <td className="max-w-[200px] px-3 py-2">
                  {o.escalation
                    ? `${o.escalation_status}: ${o.escalation.replace(/^YES: /, "").slice(0, 70)}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${outcomeTone(o.outcome)}`}
                  >
                    {o.outcome}
                  </span>
                  {o.balance_now != null ? (
                    <span className="mt-0.5 block text-muted-foreground">
                      {o.balance_at_approval != null ? `${peso(o.balance_at_approval)} → ` : "now "}
                      {peso(o.balance_now)}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
