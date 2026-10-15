import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard, ChannelBadge, RefreshButton } from "@/components/collections/Bits";
import {
  ConversationStatus,
  SummaryCell,
  PromiseCell,
  EscalatedCell,
  ReadTicks,
} from "@/components/collections/LogCells";
import {
  LogFilterBar,
  matchesLogFilters,
  sourceLabel,
  useLogFilters,
  type FilterableRow,
} from "@/components/collections/LogFilters";

export const Route = createFileRoute("/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Real WhatsApp conversations for every overdue client, synced live from Twilio via n8n.",
      },
      { property: "og:title", content: "WhatsApp Inbox | Rare Global Food Collections" },
    ],
  }),
  component: WhatsAppInbox,
});

interface WaMessage {
  role: "ai" | "client";
  content: string;
  ts: string;
  status?: string;
  notified_ar?: boolean;
  promise_recorded?: boolean;
  author?: string;
}
interface WaConversation {
  client_id: string;
  client_name: string;
  notified_ar: boolean;
  promise_recorded: boolean;
  messages: WaMessage[];
  lastMessageAt: string;
  lastMessagePreview: string;
  escalations?: { reason: string; recorded_at: string; channel: string }[];
}
interface ClientRow {
  client_id: string;
  client_name: string;
  parent_name: string;
  contact_person: string;
  phone: string;
  email: string;
  collection_amount: number;
  due_date: string;
}
interface PromiseRow {
  client_id: string;
  channel: string;
  promise_date: string;
  reason: string;
  recorded_at: string;
}
interface EscalationRow {
  client_id: string;
  channel: string;
  reason: string;
  recorded_at: string;
}

function reasonLabel(reason: string) {
  const map: Record<string, string> = {
    payment_promise: "Promise to Pay",
    investigation_hold: "Investigation Hold",
    client_unavailable: "Client Unavailable",
    business_closed_pending_review: "Business Closed (Pending Review)",
  };
  return map[reason] ?? reason;
}

function shortId(id: string) {
  const clean = id.replace(/\D/g, "") || id;
  return clean.length > 8 ? `${clean.slice(0, 4)}…${clean.slice(-4)}` : clean;
}
function shortDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return v;
  }
}
function formatTs(ts: string | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}
function digits(v: string | null | undefined) {
  return (v || "").replace(/\D/g, "");
}
function hasReplied(c: WaConversation) {
  // The client has written at least once (does not flip back when the AI answers).
  return c.messages.some((m) => m.role === "client");
}
function phoneDigitsFromClientId(clientId: string) {
  const part = clientId.includes("___") ? clientId.split("___")[1] : clientId;
  return digits(part);
}
// Most client IDs end in an email (PARENT___email), so the phone can't be read from the ID.
// Use the client's phone on file (Clients list) and fall back to the ID only if there is none.
// Compare the last 10 digits so 63917..., 0917... and 917... are the same number.
function latestForPhone<T extends { client_id: string; channel: string; recorded_at: string }>(
  rows: T[],
  phoneDigits: string,
  channel: string,
  clients: { client_id: string; phone?: string | null }[] = [],
): T | undefined {
  const last10 = (d: string) => d.slice(-10);
  const target = last10(phoneDigits);
  if (!target) return undefined;
  const phoneById = new Map(clients.map((cl) => [cl.client_id, digits(cl.phone)]));
  return rows
    .filter(
      (r) =>
        last10(phoneById.get(r.client_id) || phoneDigitsFromClientId(r.client_id)) === target &&
        String(r.channel).toLowerCase() === channel.toLowerCase(),
    )
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0];
}

function useWaConversations() {
  return useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: async () => {
      const [waRes, clientsRes, pRes, eRes, qRes] = await Promise.all([
        fetch("/api/whatsapp-conversations").then((r) => r.json()),
        fetch("/api/clients-list").then((r) => r.json()),
        fetch("/api/promise-history").then((r) => r.json()),
        fetch("/api/escalations").then((r) => r.json()),
        fetch("/api/reminder-queue-list")
          .then((r) => r.json())
          .catch(() => ({ queue: [] })),
      ]);
      return {
        conversations: (waRes.conversations ?? []) as WaConversation[],
        clients: (clientsRes.clients ?? []) as ClientRow[],
        promises: (pRes.promises ?? []) as PromiseRow[],
        escalations: (eRes.escalations ?? []) as EscalationRow[],
        queue: (qRes.queue ?? []) as {
          client_id: string;
          trigger_source?: string;
          requested_by?: string;
        }[],
      };
    },
    refetchInterval: 14400000, // 4 hours -- see hard-refresh button for on-demand updates
  });
}

function WhatsAppInbox() {
  const { data, isLoading, isFetching, error, refetch } = useWaConversations();
  const promises = data?.promises ?? [];
  const escalations = data?.escalations ?? [];
  const clients = data?.clients ?? [];
  const sourceByClient = new Map((data?.queue ?? []).map((q) => [q.client_id, q]));
  const [filters, setFilters, clearFilters] = useLogFilters();
  // Conversations are keyed by phone: match clients on the last 10 digits (63917…, 0917…, 917…).
  const last10 = (v: string | null | undefined) => digits(v).slice(-10);
  const clientForPhone = (phone: string) =>
    clients.find((cl) => !!last10(cl.phone) && last10(cl.phone) === last10(phone));

  const [active, setActive] = useState<string | null>(null);

  const conversations = useMemo(
    () =>
      (data?.conversations ?? [])
        .slice()
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()),
    [data],
  );

  const activeItem = conversations.find((c) => c.client_id === active) ?? null;
  const activeClient = activeItem
    ? clients.find((cl) => digits(cl.phone) === digits(activeItem.client_id))
    : undefined;
  const activePromise = activeItem
    ? latestForPhone(promises, digits(activeItem.client_id), "whatsapp", clients)
    : undefined;
  const activeEscalation = activeItem
    ? latestForPhone(escalations, digits(activeItem.client_id), "whatsapp", clients)
    : undefined;

  useEffect(() => {
    if (!activeItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeItem]);

  const replied = conversations.filter((c) => hasReplied(c)).length;
  const notReplied = conversations.length - replied;
  const promiseCount = conversations.filter((c) => c.promise_recorded).length;

  // Same filter rules on every channel tab (search, status, period, source).
  const rowFor = (c: (typeof conversations)[number]): FilterableRow => {
    const client = clientForPhone(c.client_id);
    const q = client ? sourceByClient.get(client.client_id) : undefined;
    const last = c.messages[c.messages.length - 1];
    return {
      name: client?.parent_name || client?.client_name || c.client_name || c.client_id,
      contact: client?.contact_person,
      extra: `${c.client_id} ${client?.email || ""}`,
      clientReplies: c.messages.filter((m) => m.role === "client").length,
      lastFrom: last ? (last.role === "client" ? "client" : "us") : "",
      hasPromise:
        !!latestForPhone(promises, digits(c.client_id), "whatsapp", clients) ||
        !!c.promise_recorded,
      hasEscalation: !!latestForPhone(escalations, digits(c.client_id), "whatsapp", clients),
      lastActivity: c.lastMessageAt,
      source: q?.trigger_source,
    };
  };
  const visible = conversations.filter((c) => matchesLogFilters(rowFor(c), filters));
  const toggleStatus = (st: "replied" | "no_reply" | "promised") =>
    setFilters({ status: filters.status === st ? "all" : st });

  return (
    <AppShell
      title="Logs"
      subtitle="WhatsApp conversations · Twilio · live from n8n"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total conversations" value={String(conversations.length)} tone="primary" />
        <StatCard
          label="Replied"
          value={String(replied)}
          hint="Client wrote at least once"
          onClick={() => toggleStatus("replied")}
          active={filters.status === "replied"}
        />
        <StatCard
          label="Not replied"
          value={String(notReplied)}
          onClick={() => toggleStatus("no_reply")}
          active={filters.status === "no_reply"}
        />
        <StatCard
          label="Promises to pay"
          value={String(promiseCount)}
          hint="Confirmed on WhatsApp"
          onClick={() => toggleStatus("promised")}
          active={filters.status === "promised"}
        />
      </div>

      <div className="mt-5">
        <LogFilterBar
          filters={filters}
          onChange={setFilters}
          onClear={clearFilters}
          shown={visible.length}
          total={conversations.length}
        />
      </div>

      <section className="surface-card mt-5 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em]">Conversations</h2>
          <span className="text-xs text-muted-foreground">
            {visible.length === conversations.length
              ? `${conversations.length} logged`
              : `${visible.length} of ${conversations.length} shown`}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Client name</th>
                <th className="px-4 py-2.5 font-semibold">Contact person</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Summary</th>
                <th className="px-4 py-2.5 font-semibold">Promise date</th>
                <th className="px-4 py-2.5 font-semibold">Escalated</th>
                <th className="px-4 py-2.5 font-semibold">Last activity</th>
                <th className="px-4 py-2.5 font-semibold">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((c) => {
                const src = (() => {
                  const cl = clientForPhone(c.client_id);
                  return cl ? sourceByClient.get(cl.client_id) : undefined;
                })();
                const promise = latestForPhone(promises, digits(c.client_id), "whatsapp", clients);
                const escalation = latestForPhone(
                  escalations,
                  digits(c.client_id),
                  "whatsapp",
                  clients,
                );
                const client = clients.find((cl) => digits(cl.phone) === digits(c.client_id));
                return (
                  <tr
                    key={c.client_id}
                    onClick={() => setActive(c.client_id)}
                    className={`cursor-pointer transition-colors ${
                      c.client_id === active ? "bg-secondary" : "hover:bg-muted"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">
                        {client?.parent_name || client?.client_name || c.client_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">
                        {client?.contact_person || c.client_name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{c.client_id}</span>
                      {client?.email ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {client.email}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <ConversationStatus
                        clientReplies={c.messages.filter((m) => m.role === "client").length}
                        lastFrom={
                          c.messages.length
                            ? c.messages[c.messages.length - 1]?.role === "client"
                              ? "client"
                              : "us"
                            : ""
                        }
                      />
                      {(() => {
                        const lastOurs = [...c.messages].reverse().find((m) => m.role === "ai");
                        if (!lastOurs?.status) return null;
                        const st = lastOurs.status.toLowerCase();
                        const label =
                          st === "read"
                            ? "Seen"
                            : st === "delivered"
                              ? "Delivered, not seen"
                              : st === "failed" || st === "undelivered"
                                ? ""
                                : "Sent";
                        return (
                          <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <ReadTicks status={lastOurs.status} />
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <SummaryCell
                        clientText={
                          [...c.messages].reverse().find((m) => m.role === "client")?.content
                        }
                        ourText={
                          [...c.messages].reverse().find((m) => m.role === "ai")?.content ??
                          c.lastMessagePreview
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      <PromiseCell promise={promise} />
                    </td>
                    <td className="px-4 py-3">
                      <EscalatedCell escalation={escalation} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {formatTs(c.lastMessageAt)}
                      {client ? (
                        <span className="block text-[11px]">
                          {peso(client.collection_amount)} due {shortDate(client.due_date)}
                        </span>
                      ) : null}
                      {src?.trigger_source ? (
                        <span className="mt-0.5 block text-[11px] font-semibold text-foreground">
                          {sourceLabel(src.trigger_source, src.requested_by)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {shortId(c.client_id)}
                    </td>
                  </tr>
                );
              })}
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading WhatsApp conversations…
                  </td>
                </tr>
              ) : null}
              {error ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-destructive">
                    Could not load WhatsApp conversations.
                  </td>
                </tr>
              ) : null}
              {!isLoading && !error && conversations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No WhatsApp activity logged yet.
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
            aria-label="Conversation detail"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200"
          >
            <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
              <div>
                <h2 className="text-base font-bold">
                  {activeClient?.parent_name || activeClient?.client_name || activeItem.client_name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Contact: {activeClient?.contact_person || activeItem.client_name}
                </p>
                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Phone:</span>{" "}
                    {activeItem.client_id}
                  </div>
                  {activeClient ? (
                    <div>
                      <span className="font-semibold text-foreground">Outstanding:</span>{" "}
                      {peso(activeClient.collection_amount)} · due{" "}
                      {shortDate(activeClient.due_date)}
                    </div>
                  ) : null}
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ChannelBadge channel="whatsapp" />
                  {activePromise ? (
                    <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                      Promised {shortDate(activePromise.promise_date)} ·{" "}
                      {reasonLabel(activePromise.reason)}
                    </span>
                  ) : null}
                  {activeEscalation ? (
                    <span
                      title={activeEscalation.reason}
                      className="max-w-[220px] truncate rounded-full bg-destructive/12 px-2.5 py-0.5 text-[11px] font-semibold text-destructive"
                    >
                      Escalated: {activeEscalation.reason}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                onClick={() => setActive(null)}
                aria-label="Close conversation detail"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="p-4">
              <div className="rounded-xl bg-[#efeae2] px-3 py-4 sm:px-5">
                {activeItem.messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#667781]">No messages yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {activeItem.messages.map((m, i) => {
                      const ours = m.role === "ai";
                      const prev = activeItem.messages[i - 1];
                      const day = waDay(m.ts);
                      const showDay = !prev || waDay(prev.ts) !== day;
                      const firstOfRun = !prev || prev.role !== m.role || showDay;
                      return (
                        <li key={i}>
                          {showDay ? (
                            <div className="my-3 flex justify-center">
                              <span className="rounded-md bg-white/90 px-3 py-1 text-[11px] font-medium text-[#54656f] shadow-sm">
                                {day}
                              </span>
                            </div>
                          ) : null}
                          <div
                            className={`flex ${ours ? "justify-end" : "justify-start"} ${firstOfRun ? "mt-2" : ""}`}
                          >
                            <div
                              className={`relative max-w-[82%] rounded-lg px-2.5 pb-1.5 pt-1.5 text-[14px] leading-[19px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] ${
                                ours ? "bg-[#d9fdd3]" : "bg-white"
                              } ${firstOfRun ? (ours ? "rounded-tr-none" : "rounded-tl-none") : ""}`}
                            >
                              {ours && (firstOfRun || m.author !== prev?.author) ? (
                                <span
                                  className={`mb-0.5 block text-[11px] font-semibold ${m.author === "ar_team" ? "text-[#1f7a3a]" : "text-[#667781]"}`}
                                >
                                  {m.author === "ar_team"
                                    ? "AR team"
                                    : m.author === "reminder"
                                      ? "Automated reminder"
                                      : "AI agent"}
                                </span>
                              ) : null}
                              {firstOfRun && !ours ? (
                                <span className="mb-0.5 block text-[12px] font-semibold text-[#027eb5]">
                                  {activeClient?.contact_person ||
                                    activeItem.client_name ||
                                    "Client"}
                                </span>
                              ) : null}
                              <span className="whitespace-pre-wrap break-words">{m.content}</span>
                              <span className="float-right ml-3 mt-1 flex translate-y-1 items-center gap-1 text-[11px] text-[#667781]">
                                {waTime(m.ts)}
                                {ours ? <ReadTicks status={m.status} /> : null}
                              </span>
                            </div>
                          </div>
                          {m.promise_recorded || m.notified_ar ? (
                            <div
                              className={`mt-1 flex gap-1.5 ${ours ? "justify-end" : "justify-start"}`}
                            >
                              {m.promise_recorded ? (
                                <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                                  Promise to pay
                                </span>
                              ) : null}
                              {m.notified_ar ? (
                                <span className="rounded-full bg-destructive/12 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                                  AR notified
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
              {(activeItem.escalations ?? []).length ? (
                <div className="mt-3 space-y-2">
                  {(activeItem.escalations ?? []).map((e, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
                    >
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-destructive">
                        AI agent notified the AR team · {waDay(e.recorded_at)}{" "}
                        {waTime(e.recorded_at)}
                      </p>
                      <p className="mt-0.5 text-sm">{e.reason}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ReadTicks status="sent" /> Sent
                </span>
                <span className="flex items-center gap-1">
                  <ReadTicks status="delivered" /> Delivered
                </span>
                <span className="flex items-center gap-1">
                  <ReadTicks status="read" /> Seen
                </span>
              </p>
            </div>
          </aside>
        </>
      ) : null}
    </AppShell>
  );
}

function peso(v: number) {
  return "₱" + Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}

function waDay(ts: string) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function waTime(ts: string) {
  const d = new Date(ts);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}
