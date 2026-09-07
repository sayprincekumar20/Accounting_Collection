import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { clientsQuery, messagesQuery, peso, shortDate } from "@/lib/collections";

export const Route = createFileRoute("/sms")({
  head: () => ({
    meta: [
      { title: "SMS Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content:
          "Real SMS conversations for every overdue client, synced live from Telerivet.",
      },
      { property: "og:title", content: "SMS Inbox | Rare Global Food Collections" },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(clientsQuery),
      context.queryClient.ensureQueryData(messagesQuery),
    ]);
  },
  component: SmsInbox,
});

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

function hasReplied(messages: { direction: string }[]) {
  const dirs = new Set(messages.map((m) => m.direction));
  return dirs.has("inbound") && dirs.has("outbound");
}

function SmsInbox() {
  const { data: clients } = useSuspenseQuery(clientsQuery);
  const { data: allMessages } = useSuspenseQuery(messagesQuery);

  const [search, setSearch] = useState("");
  const [replyFilter, setReplyFilter] = useState<"all" | "replied" | "not_replied">("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  const smsMessages = allMessages.filter((m) => m.channel === "sms");

  const threads = useMemo(() => {
    const ids = Array.from(new Set(smsMessages.map((m) => m.client_id))).filter(
      (id): id is string => !!id,
    );
    let list = ids.map((id) => {
      const client = clients.find((c) => c.id === id);
      const msgs = smsMessages
        .filter((m) => m.client_id === id)
        .slice()
        .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
      const last = msgs[msgs.length - 1];
      return { id, client, messages: msgs, last };
    });

    list.sort(
      (a, b) => new Date(b.last?.occurred_at ?? 0).getTime() - new Date(a.last?.occurred_at ?? 0).getTime(),
    );

    if (replyFilter === "replied") list = list.filter((t) => hasReplied(t.messages));
    if (replyFilter === "not_replied") list = list.filter((t) => !hasReplied(t.messages));

    const q = search.toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.client?.client_name, t.client?.phone].join(" ").toLowerCase().includes(q),
      );
    }
    return list;
  }, [clients, smsMessages, search, replyFilter]);

  const active = threads.find((t) => t.id === activeId) ?? threads[0];

  return (
    <AppShell title="SMS Inbox" subtitle="Delivered through Telerivet · relayed by n8n">
      <div
        className="bg-white rounded-xl shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-[35%_65%] border border-border"
        style={{ height: "calc(100vh - 11.5rem)" }}
      >
        {/* Left panel — thread list */}
        <div className="border-r flex flex-col min-h-0" style={{ backgroundColor: "#FFEBCE" }}>
          <div className="px-4 py-3 border-b shrink-0">
            <div className="font-black text-lg" style={{ color: "#86000B" }}>
              SMS
            </div>
          </div>
          <div className="p-3 border-b shrink-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 bg-white focus:outline-none"
            />
          </div>
          <div className="px-3 py-2 border-b shrink-0 flex gap-1.5">
            {(
              [
                { key: "all", label: "All" },
                { key: "replied", label: "Replied" },
                { key: "not_replied", label: "Not Replied" },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                onClick={() => setReplyFilter(f.key)}
                className="px-3 py-1 text-xs font-semibold rounded-md transition-colors"
                style={{
                  color: replyFilter === f.key ? "#FFFFFF" : "#1B2419",
                  backgroundColor: replyFilter === f.key ? "#86000B" : "#FFFFFF",
                  border: "1px solid #e0d6c8",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="overflow-y-auto flex-1">
            {threads.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <div className="text-2xl mb-2">💬</div>
                <div className="font-medium">No SMS activity yet</div>
              </div>
            ) : null}
            {threads.map((t) => {
              const sel = active?.id === t.id;
              const name = t.client?.client_name ?? "Unknown";
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className="w-full text-left px-4 py-3 border-b hover:bg-white transition-colors"
                  style={{
                    backgroundColor: sel ? "#FFFFFF" : "transparent",
                    borderLeft: sel ? "3px solid #86000B" : "3px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-sm truncate flex-1" style={{ color: "#1B2419" }}>
                      {name}
                    </div>
                    <div className="text-[10px] text-gray-400 shrink-0">
                      {formatTs(t.last?.occurred_at)}
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-500 truncate mt-0.5">
                    {t.client?.phone ?? "—"}
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">
                    {t.last?.body ?? "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right panel — conversation */}
        <div className="flex flex-col min-h-0" style={{ backgroundColor: "#FFF8F0" }}>
          {!active ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Select a conversation
            </div>
          ) : (
            <>
              <div
                className="px-5 py-3 flex items-center gap-3 shrink-0"
                style={{ backgroundColor: "#86000B" }}
              >
                <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {(active.client?.client_name ?? active.client?.phone ?? "?").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white font-bold leading-tight truncate">
                    {active.client?.client_name ?? "Unknown"}
                  </div>
                  <div className="text-white/70 text-xs truncate">{active.client?.phone ?? "—"}</div>
                  <div className="text-white/60 text-[10px] mt-0.5">
                    Last active {formatTs(active.last?.occurred_at)}
                  </div>
                </div>
                {active.client ? (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: active.client.id }}
                    className="shrink-0 text-xs font-semibold text-white/90 hover:text-white hover:underline"
                  >
                    View client
                  </Link>
                ) : null}
              </div>

              {active.client &&
              (active.client.collection_amount > 0 ||
                active.messages.some((m) => m.promise_recorded || m.notified_ar)) ? (
                <div
                  className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b shrink-0"
                  style={{ backgroundColor: "#FFF8F0" }}
                >
                  {active.client.collection_amount > 0 ? (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ backgroundColor: "#f0f0f0", color: "#555" }}
                    >
                      {peso(active.client.collection_amount)} outstanding · due{" "}
                      {shortDate(active.client.due_date)}
                    </span>
                  ) : null}
                  {active.messages.some((m) => m.promise_recorded) ? (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ backgroundColor: "#e8f5e9", color: "#2e7d32" }}
                    >
                      Promise to Pay
                    </span>
                  ) : null}
                  {active.messages.some((m) => m.notified_ar) ? (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ backgroundColor: "#ffebee", color: "#b71c1c" }}
                    >
                      AR Notified
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-3">
                {active.messages.length === 0 ? (
                  <div className="text-center text-sm text-gray-400 mt-8">No messages yet.</div>
                ) : null}
                {active.messages.map((m) => {
                  const out = m.direction === "outbound";
                  return (
                    <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[70%]">
                        <div
                          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                            out ? "rounded-br-sm text-white" : "rounded-bl-sm bg-white"
                          }`}
                          style={out ? { backgroundColor: "#86000B" } : { color: "#1B2419" }}
                        >
                          <span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span>
                        </div>
                        <div
                          className={`flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-500 ${
                            out ? "justify-end" : "justify-start"
                          }`}
                        >
                          <span>{formatTs(m.occurred_at)}</span>
                          {out ? (
                            <span
                              className="px-1.5 py-0 rounded-full font-semibold"
                              style={{ backgroundColor: "#f0f0f0", color: "#555" }}
                            >
                              {m.status}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
