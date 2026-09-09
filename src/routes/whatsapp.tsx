import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content: "Real WhatsApp conversations for every overdue client, synced live from Twilio.",
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
}
interface WaConversation {
  client_id: string;
  client_name: string;
  notified_ar: boolean;
  promise_recorded: boolean;
  messages: WaMessage[];
  lastMessageAt: string;
  lastMessagePreview: string;
}
interface ClientRow {
  client_id: string;
  client_name: string;
  phone: string;
  collection_amount: number;
  due_date: string;
}

function peso(v: number) {
  return "₱" + Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
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
function hasReplied(c: WaConversation) {
  const roles = new Set(c.messages.map((m) => m.role));
  return roles.has("client") && roles.has("ai");
}

function useWhatsAppConversations() {
  return useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: async () => {
      const [waRes, clientsRes] = await Promise.all([
        fetch("/api/whatsapp-conversations").then((r) => r.json()),
        fetch("/api/clients-list").then((r) => r.json()),
      ]);
      return {
        conversations: (waRes.conversations ?? []) as WaConversation[],
        clients: (clientsRes.clients ?? []) as ClientRow[],
      };
    },
    refetchInterval: 30000,
  });
}

function WhatsAppInbox() {
  const { data, isLoading, error } = useWhatsAppConversations();
  const [search, setSearch] = useState("");
  const [replyFilter, setReplyFilter] = useState<"all" | "replied" | "not_replied">("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  const conversations = useMemo(() => {
    let all = (data?.conversations ?? []).slice().sort(
      (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
    );
    if (replyFilter === "replied") all = all.filter((c) => hasReplied(c));
    if (replyFilter === "not_replied") all = all.filter((c) => !hasReplied(c));
    const q = search.toLowerCase();
    if (!q) return all;
    return all.filter((c) => c.client_name.toLowerCase().includes(q));
  }, [data, search, replyFilter]);

  const active = conversations.find((c) => c.client_id === activeId) ?? conversations[0];
  const activeClient = active
    ? (data?.clients ?? []).find((cl) => digits(cl.phone) === digits(active.client_id))
    : undefined;

  return (
    <AppShell title="WhatsApp Inbox" subtitle="Delivered through Twilio · live">
      <div
        className="bg-white rounded-xl shadow-sm overflow-hidden grid grid-cols-1 md:grid-cols-[35%_65%] border border-border"
        style={{ height: "calc(100vh - 11.5rem)" }}
      >
        <div className="border-r flex flex-col min-h-0" style={{ backgroundColor: "#DCF3E6" }}>
          <div className="px-4 py-3 border-b shrink-0">
            <div className="font-black text-lg" style={{ color: "#128C7E" }}>
              WhatsApp
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
                  backgroundColor: replyFilter === f.key ? "#128C7E" : "#FFFFFF",
                  border: "1px solid #cfe8db",
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
                <div className="font-medium">No WhatsApp activity yet</div>
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
                    borderLeft: sel ? "3px solid #128C7E" : "3px solid transparent",
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

        <div className="flex flex-col min-h-0" style={{ backgroundColor: "#ECE5DD" }}>
          {!active ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b bg-white shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold" style={{ color: "#1B2419" }}>
                    {active.client_name}
                  </div>
                  {activeClient ? (
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: activeClient.client_id }}
                      className="text-xs font-semibold shrink-0"
                      style={{ color: "#128C7E" }}
                    >
                      View client
                    </Link>
                  ) : null}
                </div>
                {activeClient ? (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {peso(activeClient.collection_amount)} outstanding · due{" "}
                    {shortDate(activeClient.due_date)}
                  </div>
                ) : null}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-3">
                {active.messages.length === 0 ? (
                  <div className="text-center text-sm text-gray-400 mt-8">No messages yet.</div>
                ) : null}
                {active.messages.map((m, i) => {
                  const out = m.role === "ai";
                  return (
                    <div key={i} className={`flex flex-col ${out ? "items-end" : "items-start"}`}>
                      {out ? (
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
                            style={{ backgroundColor: "#dcf3e6", color: "#128C7E" }}
                          >
                            WhatsApp
                          </span>
                          <span className="text-[10px] text-gray-400">twilio · {formatTs(m.ts)}</span>
                        </div>
                      ) : null}
                      <div className="max-w-[70%]">
                        <div
                          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                            out ? "rounded-br-sm text-white" : "rounded-bl-sm bg-white"
                          }`}
                          style={out ? { backgroundColor: "#128C7E" } : { color: "#1B2419" }}
                        >
                          <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                        </div>
                        <div
                          className={`flex flex-wrap items-center gap-1.5 mt-1 ${out ? "justify-end" : "justify-start"}`}
                        >
                          {!out ? (
                            <span className="text-[10px] text-gray-500">{formatTs(m.ts)}</span>
                          ) : null}
                          {out && m.status ? (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{ backgroundColor: "#f0ead6", color: "#8a6d1a" }}
                            >
                              {m.status}
                            </span>
                          ) : null}
                          {m.promise_recorded ? (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{ backgroundColor: "#e8f5e9", color: "#2e7d32" }}
                            >
                              Promise to Pay
                            </span>
                          ) : null}
                          {m.notified_ar ? (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{ backgroundColor: "#ffebee", color: "#b71c1c" }}
                            >
                              AR Notified
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
