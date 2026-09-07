import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PhoneOutgoing, PhoneIncoming, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard, ClientTime, ChannelBadge, StatusPill } from "@/components/collections/Bits";
import { clientsQuery, messagesQuery, peso, type MessageRow } from "@/lib/collections";

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
      {
        property: "og:description",
        content: "Every AI collections call with recording and transcript, synced live from Vapi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(clientsQuery),
      context.queryClient.ensureQueryData(messagesQuery),
    ]);
  },
  component: VoiceLogs,
});

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

function endedReason(m: MessageRow) {
  const raw = m.subject?.replace(/^Call ended:\s*/i, "") ?? "";
  if (!raw) {
    return m.status === "completed" ? "Customer" : m.status.replace(/_/g, " ");
  }
  return raw
    .replace(/^customer-/, "customer ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function reasonTone(m: MessageRow) {
  if (m.status === "completed") return "bg-success/12 text-success border-success/30";
  if (m.status === "failed") return "bg-destructive/12 text-destructive border-destructive/30";
  return "bg-warning/18 text-warning border-warning/40";
}

type Turn = { role: "assistant" | "user"; text: string };

function parseTranscript(transcript: string | null): Turn[] {
  if (!transcript) return [];
  const turns: Turn[] = [];
  for (const line of transcript.split(/\n+/)) {
    const match = /^\s*(AI|Assistant|Agent|User|Customer|Client)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      const role = /^(ai|assistant|agent)$/i.test(match[1]!) ? "assistant" : "user";
      turns.push({ role, text: match[2]!.trim() });
    } else if (line.trim() && turns.length) {
      turns[turns.length - 1]!.text += ` ${line.trim()}`;
    }
  }
  return turns.filter((t) => t.text);
}

// Vapi assistant "Accounting Assistant"
const ASSISTANT_ID = "c6f30764-7b72-4b97-8e0b-d09e119118f3";

function VoiceLogs() {
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const { data: messages } = useSuspenseQuery(messagesQuery);

  const calls = messages
    .filter((m) => m.channel === "voice" && m.assistant_id === ASSISTANT_ID)
    .slice()
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

  const [active, setActive] = useState<string | null>(null);
  const activeCall = calls.find((c) => c.id === active) ?? null;
  const activeClient = clients.find((c) => c.id === activeCall?.client_id);
  const turns = parseTranscript(activeCall?.transcript ?? null);

  useEffect(() => {
    if (!activeCall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeCall]);


  const completed = calls.filter((c) => c.status === "completed").length;
  const noAnswer = calls.filter((c) => c.status !== "completed").length;
  const totalDuration = calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);

  return (
    <AppShell title="Logs" subtitle="AI voice calls · Vapi · Accounting Assistant">
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total calls" value={String(calls.length)} tone="primary" />
        <StatCard label="Connected" value={String(completed)} />
        <StatCard label="Not answered / failed" value={String(noAnswer)} />
        <StatCard label="Total talk time" value={formatDuration(totalDuration)} />
        <StatCard
          label="Promises to pay"
          value={String(calls.filter((c) => c.promise_recorded).length)}
          hint="Confirmed on a call"
        />
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
                <th className="px-4 py-2.5 font-semibold">Duration</th>
                <th className="px-4 py-2.5 font-semibold">Start time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {calls.map((c) => {
                const client = clients.find((x) => x.id === c.client_id);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setActive(c.id)}
                    className={`cursor-pointer transition-colors ${
                      c.id === active ? "bg-secondary" : "hover:bg-muted"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {shortId(c.provider_message_id ?? c.id)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{c.agent_name ?? "Assistant"}</span>
                      <span className="block text-[11px] text-muted-foreground">RGF Voice · PH</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">
                        {client?.client_name ?? "Unknown"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {client?.phone ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold">
                        {c.direction === "inbound" ? (
                          <PhoneIncoming className="h-3 w-3" />
                        ) : (
                          <PhoneOutgoing className="h-3 w-3" />
                        )}
                        {c.direction === "inbound" ? "Inbound" : "Outbound"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${reasonTone(c)}`}
                      >
                        {endedReason(c)}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {formatDuration(c.duration_seconds)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      <ClientTime value={c.occurred_at} />
                    </td>
                  </tr>
                );
              })}
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No voice calls logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {activeCall ? (
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
                  <ClientTime value={activeCall.occurred_at} /> ·{" "}
                  {activeCall.direction === "inbound" ? "inboundPhoneCall" : "outboundPhoneCall"}
                </h2>
                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Call ID:</span>{" "}
                    <span className="font-mono">
                      {activeCall.provider_message_id ?? activeCall.id}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Assistant:</span>{" "}
                    {activeCall.agent_name ?? "Assistant"}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Customer:</span>{" "}
                    {activeClient?.client_name ?? "Unknown"} · {activeClient?.phone ?? "—"}
                    {activeClient ? ` · ${peso(activeClient.collection_amount)} outstanding` : ""}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Ended:</span>{" "}
                    {endedReason(activeCall)}
                  </div>
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ChannelBadge channel="voice" />
                  <StatusPill status={activeCall.status} />
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums">
                    {formatDuration(activeCall.duration_seconds)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {activeClient ? (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: activeClient.id }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    View client
                  </Link>
                ) : null}
                <button
                  onClick={() => setActive(null)}
                  aria-label="Close call detail"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="space-y-5 p-5">
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Recording
                </h3>
                {activeCall.recording_url ? (
                  <audio controls src={activeCall.recording_url} className="w-full" />
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
                {turns.length ? (
                  <ol className="space-y-4">
                    {turns.map((t, i) => (
                      <li
                        key={i}
                        className={`flex flex-col gap-1 ${t.role === "user" ? "items-end" : "items-start"}`}
                      >
                        <div className="text-[11px] text-muted-foreground">
                          {t.role === "user"
                            ? (activeClient?.client_name ?? "Client")
                            : (activeCall.agent_name ?? "Assistant")}
                        </div>
                        <div
                          className={`max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm ${
                            t.role === "user"
                              ? "border-transparent bg-primary text-primary-foreground"
                              : "border-border bg-muted"
                          }`}
                        >
                          {t.text}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : activeCall.transcript ? (
                  <div className="rounded-xl border border-border bg-muted p-4 text-sm whitespace-pre-wrap">
                    {activeCall.transcript}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No transcript — this call did not connect.
                  </p>
                )}
              </div>

              {activeCall.body && activeCall.body !== activeCall.transcript ? (
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Summary
                  </h3>
                  <p className="text-sm text-muted-foreground">{activeCall.body}</p>
                </div>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </AppShell>
  );
}
