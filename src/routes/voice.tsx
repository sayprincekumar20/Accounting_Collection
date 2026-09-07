import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PhoneOutgoing, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard, ChannelBadge, StatusPill } from "@/components/collections/Bits";

export const Route = createFileRoute("/voice")({
  head: () => ({
    meta: [
      { title: "Voice Call Logs | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "AI voice call logs — call ID, assistant, customer number, ended reason, recording and full transcript, synced live from Vapi.",
      },
      { property: "og:title", content: "Voice Call Logs | Rare Global Food Collections" },
    ],
  }),
  component: VoiceLogs,
});

interface CallListItem {
  call_id: string;
  client_id: string;
  client_name: string;
  phone: string;
  status: string;
  endedReason: string;
  startedAt: string;
  cost: number;
  hasContent: boolean;
  preview: string;
}

interface CallTurn {
  role: "assistant" | "client";
  text: string;
}

interface CallDetail {
  callId: string;
  clientName: string;
  phone: string;
  status: string;
  endedReason: string;
  startedAt: string;
  durationSeconds: number;
  cost: number;
  recordingUrl: string;
  turns: CallTurn[];
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function shortId(id: string | null) {
  if (!id) return "—";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function formatReason(raw: string, status: string) {
  if (!raw) return status === "completed" ? "Customer" : status.replace(/_/g, " ");
  return raw
    .replace(/^customer-/, "customer ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function reasonTone(status: string) {
  if (status === "completed" || status === "ended") return "bg-success/12 text-success border-success/30";
  if (status === "failed") return "bg-destructive/12 text-destructive border-destructive/30";
  return "bg-warning/18 text-warning border-warning/40";
}

function formatClientTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function useCallsList() {
  return useQuery({
    queryKey: ["vapi-calls-list"],
    queryFn: async () => {
      const r = await fetch("/api/vapi-calls-list");
      if (!r.ok) throw new Error("Voice calls fetch failed");
      const d = await r.json();
      return (d.calls ?? []) as CallListItem[];
    },
    refetchInterval: 30000,
  });
}

function useCallDetail(callId: string | null) {
  return useQuery({
    queryKey: ["vapi-call-detail", callId],
    queryFn: async () => {
      const r = await fetch(`/api/vapi-call-detail?callId=${encodeURIComponent(callId!)}`);
      if (!r.ok) throw new Error("Call detail fetch failed");
      return (await r.json()) as CallDetail;
    },
    enabled: !!callId,
  });
}

function VoiceLogs() {
  const { data: callsData, isLoading, error } = useCallsList();
  const calls = callsData ?? [];

  const [active, setActive] = useState<string | null>(null);
  const activeItem = calls.find((c) => c.call_id === active) ?? null;
  const { data: detail } = useCallDetail(activeItem?.call_id ?? null);

  useEffect(() => {
    if (!activeItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeItem]);

  const completed = calls.filter((c) => c.status === "completed" || c.status === "ended").length;
  const noAnswer = calls.length - completed;

  return (
    <AppShell title="Logs" subtitle="AI voice calls · Vapi · Accounting Assistant · live">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Total calls" value={String(calls.length)} tone="primary" />
        <StatCard label="Connected" value={String(completed)} />
        <StatCard label="Not answered / failed" value={String(noAnswer)} />
      </div>

      <section className="surface-card mt-5 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em]">Calls</h2>
          <span className="text-xs text-muted-foreground">{calls.length} logged</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Call ID</th>
                <th className="px-4 py-2.5 font-semibold">Assistant</th>
                <th className="px-4 py-2.5 font-semibold">Customer</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Ended reason</th>
                <th className="px-4 py-2.5 font-semibold">Start time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {calls.map((c) => (
                <tr
                  key={c.call_id}
                  onClick={() => setActive(c.call_id)}
                  className={`cursor-pointer transition-colors ${
                    c.call_id === active ? "bg-secondary" : "hover:bg-muted"
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {shortId(c.call_id)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold">Accounting Assistant</span>
                    <span className="block text-[11px] text-muted-foreground">RGF Voice · PH</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="block truncate font-medium">{c.client_name}</span>
                    <span className="block text-[11px] text-muted-foreground">{c.phone || "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold">
                      <PhoneOutgoing className="h-3 w-3" />
                      Outbound
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${reasonTone(c.status)}`}
                    >
                      {formatReason(c.endedReason, c.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatClientTime(c.startedAt)}
                  </td>
                </tr>
              ))}
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading calls from Vapi…
                  </td>
                </tr>
              ) : null}
              {error ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-destructive">
                    Could not load calls from Vapi.
                  </td>
                </tr>
              ) : null}
              {!isLoading && !error && calls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No voice calls logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {activeItem ? (
        <>
          <div
            onClick={() => setActive(null)}
            className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-[2px] animate-in fade-in"
          />
          <aside
            role="dialog"
            aria-label="Call detail"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200"
          >
            <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
              <div>
                <h2 className="text-base font-bold">
                  {formatClientTime(activeItem.startedAt)} · outboundPhoneCall
                </h2>
                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Call ID:</span>{" "}
                    <span className="font-mono">{activeItem.call_id}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Assistant:</span> Accounting
                    Assistant
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Customer:</span>{" "}
                    {activeItem.client_name} · {activeItem.phone || "—"}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Ended:</span>{" "}
                    {formatReason(activeItem.endedReason, activeItem.status)}
                  </div>
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ChannelBadge channel="voice" />
                  <StatusPill status={activeItem.status} />
                  {detail ? (
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums">
                      {formatDuration(detail.durationSeconds)}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                onClick={() => setActive(null)}
                aria-label="Close call detail"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-5 p-5">
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Recording
                </h3>
                {detail?.recordingUrl ? (
                  <audio controls src={detail.recordingUrl} className="w-full" />
                ) : (
                  <p className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                    No recording available for this call.
                  </p>
                )}
              </div>

              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Transcript
                </h3>
                {detail?.turns?.length ? (
                  <ol className="space-y-4">
                    {detail.turns.map((t, i) => (
                      <li
                        key={i}
                        className={`flex flex-col gap-1 ${t.role === "client" ? "items-end" : "items-start"}`}
                      >
                        <div className="text-[11px] text-muted-foreground">
                          {t.role === "client" ? activeItem.client_name : "Accounting Assistant"}
                        </div>
                        <div
                          className={`max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm ${
                            t.role === "client"
                              ? "border-transparent bg-primary text-primary-foreground"
                              : "border-border bg-muted"
                          }`}
                        >
                          {t.text}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {detail ? "No transcript — this call did not connect." : "Loading transcript…"}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </AppShell>
  );
}
