import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

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

function latestFor<T extends { client_id: string; channel: string; recorded_at: string }>(
  rows: T[],
  clientId: string,
  channel: string,
): T | undefined {
  return rows
    .filter((r) => r.client_id === clientId && r.channel === channel)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())[0];
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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "promise" | "escalated">("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  const threads = useMemo(() => {
    let all = (threadsData ?? [])
      .slice()
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    if (filter === "promise") all = all.filter((t) => t.promise_recorded);
    if (filter === "escalated") all = all.filter((t) => t.notified_ar);
    const q = search.toLowerCase();
    if (!q) return all;
    return all.filter((t) => t.client_name.toLowerCase().includes(q));
  }, [threadsData, search, filter]);

  const active = threads.find((t) => t.thread_id === activeId) ?? threads[0];
  const { data: detail, isLoading: detailLoading } = useThreadDetail(active?.thread_id ?? null);
  const messages = detail?.messages ?? [];

  const activeClient = active
    ? (sidebar?.clients ?? []).find(
        (cl) =>
          cl.client_name.toLowerCase().includes(active.client_name.toLowerCase()) ||
          active.client_name.toLowerCase().includes(cl.client_name.toLowerCase()),
      )
    : undefined;
  const promise =
    active && activeClient ? latestFor(sidebar?.promises ?? [], activeClient.client_id, "email") : undefined;
  const escalation =
    active && activeClient ? latestFor(sidebar?.escalations ?? [], activeClient.client_id, "email") : undefined;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black">Email Inbox</h1>
          <p className="text-sm text-muted-foreground">Delivered through Gmail · relayed by n8n</p>
        </div>
        <Link
          to="/"
          className="rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Back to overview
        </Link>
      </div>

      <div
        className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-white shadow-sm md:grid-cols-[35%_65%]"
        style={{ height: "calc(100vh - 11.5rem)" }}
      >
        <div className="flex min-h-0 flex-col border-r" style={{ backgroundColor: "#FBE9E7" }}>
          <div className="shrink-0 border-b px-4 py-3">
            <div className="text-lg font-black" style={{ color: "#86000B" }}>
              Email
            </div>
          </div>
          <div className="shrink-0 border-b p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none"
            />
          </div>
          <div className="flex shrink-0 gap-1.5 border-b px-3 py-2">
            {(
              [
                { key: "all", label: "All" },
                { key: "promise", label: "Promised" },
                { key: "escalated", label: "Escalated" },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="rounded-md px-3 py-1 text-xs font-semibold transition-colors"
                style={{
                  color: filter === f.key ? "#FFFFFF" : "#1B2419",
                  backgroundColor: filter === f.key ? "#86000B" : "#FFFFFF",
                  border: "1px solid #e0d6c8",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? <div className="p-4 text-sm text-gray-500">Loading Gmail threads…</div> : null}
            {error ? (
              <div className="p-4 text-sm text-red-600">Could not load Gmail threads from n8n.</div>
            ) : null}
            {!isLoading && !error && threads.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <div className="mb-2 text-2xl">✉️</div>
                <div className="font-medium">No Email activity logged yet</div>
              </div>
            ) : null}
            {threads.map((t) => {
              const sel = active?.thread_id === t.thread_id;
              return (
                <button
                  key={t.thread_id || t.client_id}
                  onClick={() => setActiveId(t.thread_id)}
                  className="w-full border-b px-4 py-3 text-left transition-colors hover:bg-white"
                  style={{
                    backgroundColor: sel ? "#FFFFFF" : "transparent",
                    borderLeft: sel ? "3px solid #86000B" : "3px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 truncate text-sm font-bold" style={{ color: "#1B2419" }}>
                      {t.client_name}
                    </div>
                    <div className="shrink-0 text-[10px] text-gray-400">{formatTs(t.lastMessageAt)}</div>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">{t.lastMessagePreview || "—"}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.promise_recorded ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: "#e8f5e9", color: "#2e7d32" }}
                      >
                        Promise to Pay
                      </span>
                    ) : null}
                    {t.notified_ar ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: "#ffebee", color: "#b71c1c" }}
                      >
                        AR Notified
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-col" style={{ backgroundColor: "#FFF8F0" }}>
          {!active ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b bg-white px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold" style={{ color: "#1B2419" }}>
                    {active.client_name}
                  </div>
                  {activeClient ? (
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: activeClient.client_id }}
                      className="shrink-0 text-xs font-semibold"
                      style={{ color: "#86000B" }}
                    >
                      View client
                    </Link>
                  ) : null}
                </div>
                {activeClient ? (
                  <div className="mt-0.5 text-xs text-gray-500">
                    {peso(activeClient.collection_amount)} outstanding · due {shortDate(activeClient.due_date)}
                  </div>
                ) : null}
                {detail?.subject ? (
                  <div className="mt-1 truncate text-xs font-medium text-gray-600">{detail.subject}</div>
                ) : null}
                {promise || escalation ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {promise ? (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: "#e8f5e9", color: "#2e7d32" }}
                      >
                        Promised {shortDate(promise.promise_date)} · {reasonLabel(promise.reason)}
                      </span>
                    ) : null}
                    {escalation ? (
                      <span
                        title={escalation.reason}
                        className="max-w-[260px] truncate rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: "#ffebee", color: "#b71c1c" }}
                      >
                        Escalated: {escalation.reason}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-5">
                {messages.map((m) => {
                  const outbound = m.direction === "outbound";
                  const name = (m.from.split("<")[0] || m.from).replace(/"/g, "").trim() || m.from;
                  const initial = name.charAt(0).toUpperCase();
                  return (
                    <div key={m.messageId} className="rounded-xl border bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                          style={{ backgroundColor: outbound ? "#86000B" : "#9c9c9c" }}
                        >
                          {initial}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="truncate text-sm font-semibold" style={{ color: "#1B2419" }}>
                              {name}
                            </span>
                            <span className="truncate text-xs text-gray-400">{m.from}</span>
                            <span className="ml-auto shrink-0 text-xs text-gray-400">{formatTs(m.date)}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-400">to {m.to}</p>
                          <div className="mt-3 text-sm leading-relaxed">
                            <MessageBody body={m.body} />
                          </div>
                          {m.attachments?.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {m.attachments.map((a) => (
                                <span
                                  key={a.filename}
                                  className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs"
                                >
                                  {a.filename}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {detailLoading ? (
                  <div className="py-6 text-center text-sm text-gray-400">Loading thread from Gmail…</div>
                ) : null}
                {!detailLoading && messages.length === 0 ? (
                  <div className="py-6 text-center text-sm text-gray-400">Nothing to show.</div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
