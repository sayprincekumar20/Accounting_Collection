import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard, ChannelBadge } from "@/components/collections/Bits";

export const Route = createFileRoute("/email")({
  head: () => ({
    meta: [
      { title: "Email Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Real Gmail threads for every overdue client — subject, sender, timestamps and full message body in one collections inbox.",
      },
      { property: "og:title", content: "Email Inbox | Rare Global Food Collections" },
      {
        property: "og:description",
        content: "Live Gmail conversation history for overdue collections follow-ups.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmailInbox,
});

interface ThreadListItem {
  client_id: string;
  client_name: string;
  contact_person: string;
  thread_id: string;
  notified_ar: boolean;
  promise_recorded: boolean;
  message_count: number;
  lastMessagePreview: string;
  lastDirection: string;
  lastMessageAt: string;
}
interface ThreadAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  messageId: string;
}
interface ThreadMessage {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  attachments: ThreadAttachment[];
  direction: "inbound" | "outbound";
}
interface ThreadDetail {
  threadId: string;
  subject: string;
  messages: ThreadMessage[];
}
interface ClientRow {
  client_id: string;
  client_name: string;
  parent_name: string;
  contact_person: string;
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
function peso(v: number) {
  return "₱" + Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}
function shortId(id: string) {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return value;
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
function isHtmlBody(body: string): boolean {
  return /<html[\s>]/i.test(body) || /<!DOCTYPE html/i.test(body);
}

function latestFor<T extends { client_id: string; channel: string; recorded_at: string }>(
  rows: T[],
  clientId: string,
  channel: string,
): T | undefined {
  return rows
    .filter((r) => r.client_id === clientId && r.channel === channel)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0];
}

function useThreadsList() {
  return useQuery({
    queryKey: ["gmail-threads-list"],
    queryFn: async () => {
      const r = await fetch("/api/gmail-threads-list");
      if (!r.ok) throw new Error("Email threads fetch failed");
      const d = await r.json();
      return (d.threads ?? []) as ThreadListItem[];
    },
    refetchInterval: 30000,
  });
}
function useThreadDetail(threadId: string | null) {
  return useQuery({
    queryKey: ["gmail-thread-detail", threadId],
    queryFn: async () => {
      const r = await fetch(`/api/gmail-thread-detail?threadId=${encodeURIComponent(threadId!)}`);
      if (!r.ok) throw new Error("Thread detail fetch failed");
      return (await r.json()) as ThreadDetail;
    },
    enabled: !!threadId,
  });
}
function useEmailSidebar() {
  return useQuery({
    queryKey: ["email-sidebar-data"],
    queryFn: async () => {
      const [clientsRes, pRes, eRes] = await Promise.all([
        fetch("/api/clients-list").then((r) => r.json()),
        fetch("/api/promise-history").then((r) => r.json()),
        fetch("/api/escalations").then((r) => r.json()),
      ]);
      return {
        clients: (clientsRes.clients ?? []) as ClientRow[],
        promises: (pRes.promises ?? []) as PromiseRow[],
        escalations: (eRes.escalations ?? []) as EscalationRow[],
      };
    },
    refetchInterval: 30000,
  });
}

function MessageBody({ body }: { body: string }) {
  if (isHtmlBody(body)) {
    return (
      <iframe
        title="email-body"
        srcDoc={body}
        sandbox=""
        className="w-full border-0"
        style={{ minHeight: "140px" }}
        onLoad={(e) => {
          const el = e.currentTarget;
          try {
            const h = el.contentWindow?.document.body.scrollHeight;
            if (h) el.style.height = h + 20 + "px";
          } catch {
            /* ignore */
          }
        }}
      />
    );
  }
  return <p className="whitespace-pre-wrap">{body}</p>;
}

function EmailInbox() {
  const { data: threadsData, isLoading, error } = useThreadsList();
  const { data: sidebar } = useEmailSidebar();
  const clients = sidebar?.clients ?? [];
  const promises = sidebar?.promises ?? [];
  const escalations = sidebar?.escalations ?? [];

  const [active, setActive] = useState<string | null>(null);

  const threads = useMemo(
    () =>
      (threadsData ?? [])
        .slice()
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()),
    [threadsData],
  );

  const activeItem = threads.find((t) => t.thread_id === active) ?? null;
  const { data: detail, isLoading: detailLoading } = useThreadDetail(activeItem?.thread_id ?? null);
  const messages = detail?.messages ?? [];

  function findClient(clientId: string, clientName: string) {
    return (
      clients.find((cl) => cl.client_id === clientId) ??
      clients.find(
        (cl) =>
          cl.client_name.toLowerCase().includes(clientName.toLowerCase()) ||
          clientName.toLowerCase().includes(cl.client_name.toLowerCase()),
      )
    );
  }

  const activeClient = activeItem ? findClient(activeItem.client_id, activeItem.client_name) : undefined;
  const activePromise =
    activeItem && activeClient ? latestFor(promises, activeClient.client_id, "email") : undefined;
  const activeEscalation =
    activeItem && activeClient ? latestFor(escalations, activeClient.client_id, "email") : undefined;

  useEffect(() => {
    if (!activeItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeItem]);

  const replied = threads.filter((t) => t.lastDirection === "inbound").length;
  const notReplied = threads.length - replied;
  const promiseCount = threads.filter((t) => t.promise_recorded).length;

  return (
    <AppShell title="Logs" subtitle="Email threads · Gmail · relayed by n8n · live">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total threads" value={String(threads.length)} tone="primary" />
        <StatCard label="Replied" value={String(replied)} />
        <StatCard label="Not replied" value={String(notReplied)} />
        <StatCard label="Promises to pay" value={String(promiseCount)} hint="Confirmed by email" />
      </div>

      <section className="surface-card mt-5 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em]">Threads</h2>
          <span className="text-xs text-muted-foreground">{threads.length} logged</span>
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
              {threads.map((t) => {
                const client = findClient(t.client_id, t.client_name);
                const promise = client ? latestFor(promises, client.client_id, "email") : undefined;
                const escalation = client ? latestFor(escalations, client.client_id, "email") : undefined;
                return (
                  <tr
                    key={t.thread_id || t.client_id}
                    onClick={() => setActive(t.thread_id)}
                    className={`cursor-pointer transition-colors ${
                      t.thread_id === active ? "bg-secondary" : "hover:bg-muted"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {shortId(t.thread_id)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">
                        {client?.parent_name || client?.client_name || t.client_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block truncate font-medium">
                        {client?.contact_person || t.contact_person || t.client_name}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {client?.email || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          t.lastDirection === "inbound"
                            ? "bg-success/12 text-success border-success/30"
                            : "bg-warning/18 text-warning border-warning/40"
                        }`}
                      >
                        {t.lastDirection === "inbound" ? "Replied" : "Awaiting reply"}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <span className="block truncate text-xs text-muted-foreground" title={t.lastMessagePreview}>
                        {t.lastMessagePreview || "—"}
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
                      {formatTs(t.lastMessageAt)}
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
                    Loading Gmail threads…
                  </td>
                </tr>
              ) : null}
              {error ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-destructive">
                    Could not load Gmail threads from n8n.
                  </td>
                </tr>
              ) : null}
              {!isLoading && !error && threads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No Email activity logged yet.
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
            aria-label="Thread detail"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200"
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
                  {detail?.subject ? (
                    <div>
                      <span className="font-semibold text-foreground">Subject:</span> {detail.subject}
                    </div>
                  ) : null}
                  {activeClient ? (
                    <div>
                      <span className="font-semibold text-foreground">Outstanding:</span>{" "}
                      {peso(activeClient.collection_amount)} · due {shortDate(activeClient.due_date)}
                    </div>
                  ) : null}
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ChannelBadge channel="email" />
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums">
                    {messages.length} message{messages.length === 1 ? "" : "s"}
                  </span>
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
                aria-label="Close thread detail"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <ol className="divide-y divide-border">
              {messages.map((m) => {
                const outbound = m.direction === "outbound";
                const name = (m.from.split("<")[0] || m.from).replace(/"/g, "").trim() || m.from;
                const initial = name.charAt(0).toUpperCase();
                return (
                  <li key={m.messageId} className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                        style={{
                          color: outbound ? "var(--primary-foreground)" : "var(--foreground)",
                          backgroundColor: outbound
                            ? "var(--primary)"
                            : "color-mix(in oklab, var(--foreground) 10%, transparent)",
                        }}
                      >
                        {initial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate text-sm font-semibold">{name}</span>
                          <span className="truncate text-xs text-muted-foreground">{m.from}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {formatTs(m.date)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">to {m.to}</p>
                        <div className="mt-3 text-sm leading-relaxed">
                          <MessageBody body={m.body} />
                        </div>
                        {m.attachments?.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {m.attachments.map((a) => (
                              <a
                                key={a.attachmentId}
                                href={`/api/gmail-attachment?messageId=${encodeURIComponent(a.messageId)}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-lg border border-border bg-muted px-2.5 py-1 text-xs hover:bg-accent hover:underline"
                              >
                                📎 {a.filename}
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
              {detailLoading ? (
                <li className="px-5 py-6 text-sm text-muted-foreground">Loading thread from Gmail…</li>
              ) : null}
              {!detailLoading && messages.length === 0 ? (
                <li className="px-5 py-6 text-sm text-muted-foreground">Nothing to show.</li>
              ) : null}
            </ol>
          </aside>
        </>
      ) : null}
    </AppShell>
  );
}
