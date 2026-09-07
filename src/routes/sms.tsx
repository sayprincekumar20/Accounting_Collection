import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";

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
  role: "ai" | "customer";
  content: string;
  ts: string;
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

function hasReplied(c: SmsConversation) {
  const roles = new Set(c.messages.map((m) => m.role));
  return roles.has("customer") && roles.has("ai");
}

function useSmsConversations() {
  return useQuery({
    queryKey: ["sms-conversations"],
    queryFn: async () => {
      const r = await fetch("/api/sms-conversations");
      if (!r.ok) throw new Error("SMS fetch failed");
      const d = await r.json();
      return (d.conversations ?? []) as SmsConversation[];
    },
    refetchInterval: 30000,
  });
}

function SmsInbox() {
  const { data, isLoading, error } = useSmsConversations();
  const [search, setSearch] = useState("");
  const [replyFilter, setReplyFilter] = useState<"all" | "replied" | "not_replied">("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  const conversations = useMemo(() => {
    let all = (data ?? []).slice().sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );
    if (replyFilter === "replied") all = all.filter((c) => hasReplied(c));
    if (replyFilter === "not_replied") all = all.filter((c) => !hasReplied(c));
    const q = search.toLowerCase();
    if (!q) return all;
    return all.filter((c) => [c.client_name].join(" ").toLowerCase().includes(q));
  }, [data, search, replyFilter]);

  const active = conversations.find((c) => c.client_id === activeId) ?? conversations[0];

  return (
    <AppShell title="SMS Inbox" subtitle="Delivered through Telerivet · live from n8n">
      <div
        className="bg-white rounded-xl shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-[35%_65%] border border-border"
        style={{ height: "calc(100vh - 11.5rem)" }}
      >
        {/* Left panel — conversation list */}
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
              placeholder="Search by name…"
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
            {isLoading ? <div className="p-4 text-sm text-gray-500">Loading…</div> : null}
            {error ? <div className="p-4 text-sm text-red-600">Failed to load conversations.</div> : null}
            {!isLoading && conversations.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <div className="text-2xl mb-2">💬</div>
                <div className="font-medium">No SMS activity yet</div>
              </div>
            ) : null}
            {conversations.map((c) => {
              const sel = active?.client_id === c.client_id;
              return (
                <button
                  key={c.client_id}
                  onClick={() => setActiveId(c.client_id)}
                  className="w-full text-left px-4 py-3 border-b hover:bg-white transition-colors"
                  style={{
                    backgroundColor: sel ? "#FFFFFF" : "transparent",
                    borderLeft: sel ? "3px solid #86000B" : "3px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-sm truncate flex-1" style={{ color: "#1B2419" }}>
                      {c.client_name}
                    </div>
                    <div className="text-[10px] text-gray-400 shrink-0">
                      {formatTs(c.lastMessageAt)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">
                    {c.lastMessagePreview || "—"}
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
                  {active.client_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white font-bold leading-tight truncate">
                    {active.client_name}
                  </div>
                  <div className="text-white/60 text-[10px] mt-0.5">
                    Last active {formatTs(active.lastMessageAt)}
                  </div>
                </div>
              </div>

              {active.promise_recorded || active.notified_ar ? (
                <div
                  className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b shrink-0"
                  style={{ backgroundColor: "#FFF8F0" }}
                >
                  {active.promise_recorded ? (
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ backgroundColor: "#e8f5e9", color: "#2e7d32" }}
                    >
                      Promise to Pay
                    </span>
                  ) : null}
                  {active.notified_ar ? (
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
                {active.messages.map((m, i) => {
                  const out = m.role === "ai";
                  return (
                    <div key={i} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[70%]">
                        <div
                          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                            out ? "rounded-br-sm text-white" : "rounded-bl-sm bg-white"
                          }`}
                          style={out ? { backgroundColor: "#86000B" } : { color: "#1B2419" }}
                        >
                          <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                        </div>
                        <div
                          className={`text-[10px] text-gray-500 mt-0.5 ${out ? "text-right" : "text-left"}`}
                        >
                          {formatTs(m.ts)}
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
