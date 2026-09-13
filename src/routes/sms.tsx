import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard, ChannelBadge } from "@/components/collections/Bits";

export const Route = createFileRoute("/sms")({
  head: () => ({
    meta: [
      { title: "SMS Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content: "Real SMS conversations for every overdue client, synced live from Telerivet via n8n.",
      },
      { property: "og:title", content: "SMS Inbox | Rare Global Food Collections" },
    ],
  }),
  component: SmsInbox,
});

interface SmsMessage {
  role: "ai" | "client";
  content: string;
  ts: string;
  status?: string;
  notified_ar?: boolean;
  promise_recorded?: boolean;
}
interface SmsConversation {
  client_id: string;
  client_name: string;
  notified_ar: boolean;
  promise_recorded: boolean;
  messages: SmsMessage[];
  lastMessageAt: string;
  lastMessagePreview: string;
}
interface ClientRow {
  client_id: string;
  client_name: string;
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
    return new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
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
function hasReplied(c: SmsConversation) {
  const roles = new Set(c.messages.map((m) => m.role));
  return roles.has("client") && roles.has("ai");
}
function phoneDigitsFromClientId(clientId: string) {
  const part = clientId.includes("___") ? clientId.split("___")[1] : clientId;
  return digits(part);
}
function latestForPhone<T extends { client_id: string; channel: string; recorded_at: string }>(
  rows: T[],
  phoneDigits: string,
  channel: string,
): T | undefined {
  return rows
    .filter((r) => phoneDigitsFromClientId(r.client_id) === phoneDigits && r.channel === channel)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0];
}

function useSmsConversations() {
  return useQuery({
    queryKey: ["sms-conversations"],
    queryFn: async () => {
      const [smsRes, clientsRes, pRes, eRes] = await Promise.all([
        fetch("/api/sms-conversations").then((r) => r.json()),
        fetch("/api/clients-list").then((r) => r.json()),
        fetch("/api/promise-history").then((r) => r.json()),
        fetch("/api/escalations").then((r) => r.json()),
      ]);
      return {
        conversations: (smsRes.conversations ?? []) as SmsConversation[],
        clients: (clientsRes.clients ?? []) as ClientRow[],
        promises: (pRes.promises ?? []) as PromiseRow[],
        escalations: (eRes.escalations ?? []) as EscalationRow[],
      };
    },
    refetchInterval: 30000,
  });
}

function SmsInbox() {
  const { data, isLoading, error } = useSmsConversations();
  const promises = data?.promises ?? [];
  const escalations = data?.escalations ?? [];
  const clients = data?.clients ?? [];

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
    ? latestForPhone(promises, digits(activeItem.client_id), "sms")
    : undefined;
  const activeEscalation = activeItem
    ? latestForPhone(escalations, digits(activeItem.client_id), "sms")
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

  return (
    <AppShell title="Logs" subtitle="SMS conversations · Telerivet · live from n8n">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total conversations" value={String(conversations.length)} tone="primary" />
        <StatCard label="Replied" value={String(replied)} />
        <StatCard label="Not replied" value={String(notReplied)} />
        <StatCard label="Promises to pay" value={String(promiseCount)} hint="Confirmed on SMS" />
      </div>

      <section className="surface-card mt-5 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em]">Conversations</h2>
          <span className="text-xs text-muted-foreground">{conversations.length} logged</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">ID</th>
                <th className="px-4 py-2.5 font-semibold">Client name</th>
                <th className="px-4 py-2.5 font-semibold">Contact person</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Summary</th>
                <th className="px-4 py-2.5 font-semibold">Promise date</th>
                <th className="px-4 py-2.5 font-semibold">Escalated</th>
                <th className="px-4 py-2.5 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {conversations.map((c) => {
                const promise = latestForPhone(promises, digits(c.client_id), "sms");
                const escalation = latestForPhone(escalations, digits(c.client_id), "sms");
                const client = clients.find((cl) => digits(cl.phone) === digits(c.client_id));
                return (
                  <tr
                    key={c.client_id}
                    onClick={() => setActive(c.client_id)}
                    className={`cursor-pointer transition-colors ${
                      c.client_id === active ? "bg-secondary" : "hover:bg-muted"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {shortId(c.client_id)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">
                        {client?.client_name || c.client_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">
                        {client?.contact_person || c.client_name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{c.client_id}</span>
                      {client?.email ? (
                        <span className="block text-[11px] text-muted-foreground">{client.email}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          hasReplied(c)
                            ? "bg-success/12 text-success border-success/30"
                            : "bg-warning/18 text-warning border-warning/40"
                        }`}
                      >
                        {hasReplied(c) ? "Replied" : "Awaiting reply"}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <span className="block truncate text-xs text-muted-foreground" title={c.lastMessagePreview}>
                        {c.lastMessagePreview || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {promise ? (
                        <span className="inline-flex flex-col">
                          <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                            {shortDate(promise.promise_date)}
                          </span>
                          <span className="mt-0.5 text-[10px] text-muted-foreground">
                            {reasonLabel(promise.reason)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {escalation ? (
                        <span
                          title={escalation.reason}
                          className="inline-block max-w-[160px] truncate rounded-full bg-destructive/12 px-2.5 py-0.5 text-[11px] font-semibold text-destructive"
                        >
                          {escalation.reason}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {formatTs(c.lastMessageAt)}
                      {client ? (
                        <span className="block text-[11px]">
                          {peso(client.collection_amount)} due {shortDate(client.due_date)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading SMS conversations…
                  </td>
                </tr>
              ) : null}
              {error ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-destructive">
                    Could not load SMS conversations.
                  </td>
                </tr>
              ) : null}
              {!isLoading && !error && conversations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No SMS activity logged yet.
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
                  {activeClient?.client_name || activeItem.client_name}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Contact: {activeClient?.contact_person || activeItem.client_name}
                </p>
                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Phone:</span> {activeItem.client_id}
                  </div>
                  {activeClient ? (
                    <div>
                      <span className="font-semibold text-foreground">Outstanding:</span>{" "}
                      {peso(activeClient.collection_amount)} · due {shortDate(activeClient.due_date)}
                    </div>
                  ) : null}
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ChannelBadge channel="sms" />
                  {activePromise ? (
                    <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                      Promised {shortDate(activePromise.promise_date)} · {reasonLabel(activePromise.reason)}
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

            <div className="space-y-4 p-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Full conversation
              </h3>
              {activeItem.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              ) : (
                <ol className="space-y-4">
                  {activeItem.messages.map((m, i) => (
                    <li
                      key={i}
                      className={`flex flex-col gap-1 ${m.role === "ai" ? "items-end" : "items-start"}`}
                    >
                      <div className="text-[11px] text-muted-foreground">
                        {m.role === "ai" ? "Accounting Assistant" : activeClient?.contact_person || activeItem.client_name}
                        {" · "}
                        {formatTs(m.ts)}
                      </div>
                      <div
                        className={`max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm ${
                          m.role === "ai"
                            ? "border-transparent bg-primary text-primary-foreground"
                            : "border-border bg-muted"
                        }`}
                      >
                        <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.status ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {m.status}
                          </span>
                        ) : null}
                        {m.promise_recorded ? (
                          <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                            Promise to Pay
                          </span>
                        ) : null}
                        {m.notified_ar ? (
                          <span className="rounded-full bg-destructive/12 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            AR Notified
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
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
