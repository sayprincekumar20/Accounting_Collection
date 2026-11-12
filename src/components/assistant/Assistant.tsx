import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  BrainCircuit,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  Send,
  X,
  History,
  Loader2,
} from "lucide-react";
import { setLogFilters } from "@/components/collections/LogFilters";
import { AssistantHome } from "./AssistantHome";
import { ListReview, SheetPicker } from "./ListReview";
import { ListBoundary } from "./AssistantBoundary";
import { CONVERSATIONS_KEY } from "./store-key";
import { fileStore, reviewStore } from "./list-store";
import { parseListFile } from "@/lib/assistant/list-file";
import { normalizeReviewRows, reviewSummaryText, type ReviewRow } from "@/lib/assistant/list-match";
import { EXAMPLE_COMMANDS, fetchAssistantHome } from "./home-data";

// AI operations assistant: floating button -> side panel / full screen. Conversations are kept in this
// browser; every question is answered by /api/assistant/chat (OpenAI + the dashboard's Action Registry).
type Role = "user" | "assistant";
interface ToolStatus {
  id: string;
  status: string;
  summary?: string;
}
interface ConfirmReq {
  id: string;
  args: unknown;
  description: string;
  state?: "pending" | "done" | "cancelled";
}
interface Msg {
  role: Role;
  content: string;
  tools?: ToolStatus[];
  confirm?: ConfirmReq;
  /** Contact lists: identifies this message when it is updated later. */
  uid?: string;
  /** Contact lists: the attached file whose sheets the user can pick (data lives in list-store, in memory). */
  sheetPick?: { fileId: string };
  /** Contact lists: the review table of one sheet (data lives in list-store, in memory). */
  review?: { id: string };
}
interface Convo {
  id: string;
  title: string;
  updated: number;
  messages: Msg[];
  workingSet: { ids: string[]; label: string } | null;
}

const STORE = CONVERSATIONS_KEY;
const TOOL_LABEL: Record<string, string> = {
  get_overview: "Reading the overview",
  find_clients: "Searching clients",
  get_client: "Loading the client",
  list_invoices: "Loading invoices",
  message_history: "Reading message history",
  failed_messages: "Checking failed messages",
  promises: "Checking promises",
  escalations: "Reading the AR worklist",
  queue_status: "Reading the reminder queue",
  reports: "Listing reports",
  run_logs: "Reading run logs",
  workflow_health: "Checking workflow health",
  navigate: "Opening the page",
  refresh_data: "Refreshing",
};

const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const loadConvos = (): Convo[] => {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "[]") as Convo[];
  } catch {
    return [];
  }
};
const saveConvos = (c: Convo[]) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(c.slice(0, 30)));
  } catch {
    // storage full / unavailable
  }
};

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const home = useQuery({
    queryKey: ["assistant-home"],
    queryFn: fetchAssistantHome,
    enabled: open,
    staleTime: 30_000,
    refetchInterval: open ? 60_000 : false,
    retry: 1,
  });

  useEffect(() => {
    const c = loadConvos();
    setConvos(c);
    if (c[0]) setActiveId(c[0].id);
  }, []);
  const active = useMemo(() => convos.find((c) => c.id === activeId), [convos, activeId]);
  useEffect(
    () => endRef.current?.scrollIntoView({ behavior: "smooth" }),
    [active?.messages.length, active?.messages.at(-1)?.content],
  );

  const update = (id: string, fn: (c: Convo) => Convo) =>
    setConvos((prev) => {
      const next = prev.map((c) => (c.id === id ? fn(c) : c)).sort((a, b) => b.updated - a.updated);
      saveConvos(next);
      return next;
    });

  const newConvo = () => {
    const c: Convo = {
      id: newId(),
      title: "New conversation",
      updated: Date.now(),
      messages: [],
      workingSet: null,
    };
    setConvos((prev) => {
      const next = [c, ...prev];
      saveConvos(next);
      return next;
    });
    setActiveId(c.id);
    setShowHistory(false);
    return c;
  };

  const userName = () => {
    try {
      let n = sessionStorage.getItem("rgf-handler-name") || "";
      if (!n) {
        n = (window.prompt("Your name (recorded in the assistant's audit log):", "") || "").trim();
        if (n) sessionStorage.setItem("rgf-handler-name", n);
      }
      return n || "dashboard user";
    } catch {
      return "dashboard user";
    }
  };

  const clientOnPage = path.startsWith("/clients/")
    ? decodeURIComponent(path.slice("/clients/".length))
    : "";

  async function ask(text: string, confirm?: { id: string; args: unknown }) {
    if (busy) return;
    const convo = active ?? newConvo();
    const id = convo.id;
    const userMsgs: Msg[] = text
      ? [...convo.messages, { role: "user", content: text }]
      : convo.messages;
    const history = userMsgs
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    update(id, (c) => ({
      ...c,
      title: c.messages.length || !text ? c.title : text.slice(0, 60),
      updated: Date.now(),
      messages: [...userMsgs, { role: "assistant", content: "", tools: [] }],
    }));
    setInput("");
    setBusy(true);
    const patchLast = (fn: (m: Msg) => Msg) =>
      update(id, (c) => ({
        ...c,
        messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? fn(m) : m)),
      }));
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          context: { page: path, client: clientOnPage, workingSet: convo.workingSet ?? undefined },
          user_name: userName(),
          session_id: id,
          confirm,
        }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Assistant unavailable (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i).trim();
          buf = buf.slice(i + 2);
          if (!chunk.startsWith("data:")) continue;
          const ev = JSON.parse(chunk.slice(5)) as Record<string, unknown>;
          if (ev["type"] === "text")
            patchLast((m) => ({ ...m, content: m.content + String(ev["delta"] ?? "") }));
          else if (ev["type"] === "tool")
            patchLast((m) => {
              const tools = [...(m.tools ?? [])];
              const t: ToolStatus = { id: String(ev["id"]), status: String(ev["status"]) };
              if (ev["summary"] != null) t.summary = String(ev["summary"]);
              const k = tools.findIndex((x) => x.id === t.id && x.status === "running");
              if (k >= 0) tools[k] = t;
              else tools.push(t);
              return { ...m, tools };
            });
          else if (ev["type"] === "working_set")
            update(id, (c) => ({
              ...c,
              workingSet: { ids: (ev["ids"] as string[]) ?? [], label: String(ev["label"] ?? "") },
            }));
          else if (ev["type"] === "ui") {
            if (ev["op"] === "navigate" && ev["to"]) {
              const search = (ev["search"] as Record<string, string>) ?? {};
              if (Object.keys(search).length) setLogFilters(search);
              void navigate({ to: String(ev["to"]) as "/" });
            } else if (ev["op"] === "refresh") void qc.invalidateQueries();
          } else if (ev["type"] === "confirm")
            patchLast((m) => ({
              ...m,
              confirm: {
                id: String(ev["id"]),
                args: ev["args"],
                description: String(ev["description"] ?? ""),
                state: "pending",
              },
            }));
          else if (ev["type"] === "error")
            patchLast((m) => ({
              ...m,
              content: m.content + `\n\n_Error: ${String(ev["message"])}_`,
            }));
        }
      }
    } catch (e) {
      patchLast((m) => ({
        ...m,
        content: m.content + `\n\n_${e instanceof Error ? e.message : "Something went wrong"}_`,
      }));
    } finally {
      setBusy(false);
    }
  }

  // ---- contact lists: attach an Excel / CSV file, pick a sheet, review the matched clients
  const appendMsg = (convoId: string, m: Msg) =>
    update(convoId, (c) => ({
      ...c,
      updated: Date.now(),
      title: c.messages.length ? c.title : "Contact list",
      messages: [...c.messages, m],
    }));
  const patchMsg = (convoId: string, uid: string, fn: (m: Msg) => Msg) =>
    update(convoId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.uid === uid ? fn(m) : m)),
    }));
  const failMsg = (convoId: string, uid: string, e: unknown) =>
    patchMsg(convoId, uid, (m) => ({
      ...m,
      content: `I could not do that: ${e instanceof Error ? e.message : "something went wrong"}`,
    }));

  async function matchSheet(convoId: string, uid: string, fileId: string, sheetName: string) {
    const f = fileStore.get(fileId);
    const sheet = f?.sheets.find((s) => s.name === sheetName);
    if (!f || !sheet) {
      failMsg(convoId, uid, new Error("the file is no longer loaded, please attach it again"));
      return;
    }
    patchMsg(convoId, uid, (m) => ({
      ...m,
      content: `Matching ${sheet.rows.length} customers from sheet "${sheetName}" to our clients…`,
    }));
    try {
      const res = await fetch("/api/assistant/list-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: sheet.rows }),
      });
      const j = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok || !Array.isArray(j.rows))
        throw new Error(j.error || `Matching failed (${res.status})`);
      // Never trust the exact shape of the server's answer: rebuild every row with safe types.
      const rows: ReviewRow[] = normalizeReviewRows(j.rows);
      if (!rows.length) throw new Error("The matching returned no rows to review.");
      const summary = reviewSummaryText(sheetName, rows);
      const reviewId = newId();
      reviewStore.set(reviewId, {
        id: reviewId,
        fileName: f.name,
        sheet: sheetName,
        rows,
        result: null,
      });
      const ids = [
        ...new Set(rows.filter((r) => r.client && r.selectable).map((r) => r.client!.client_id)),
      ];
      patchMsg(convoId, uid, (m) => ({ ...m, content: summary, review: { id: reviewId } }));
      if (ids.length)
        update(convoId, (c) => ({ ...c, workingSet: { ids, label: `list ${sheetName}` } }));
    } catch (e) {
      failMsg(convoId, uid, e);
    }
  }

  async function onFile(file: File) {
    if (busy) return;
    const convo = active ?? newConvo();
    const id = convo.id;
    const uid = newId();
    appendMsg(id, { role: "user", content: `Attached ${file.name}` });
    appendMsg(id, { role: "assistant", content: "Reading the file…", uid });
    try {
      const parsed = await parseListFile(file);
      fileStore.set(parsed.id, parsed);
      const usable = parsed.sheets.filter((s) => s.rows.length);
      if (!usable.length) {
        patchMsg(id, uid, (m) => ({
          ...m,
          content:
            `I could not find customer names in ${file.name}. ${parsed.sheets[0]?.note ?? ""}`.trim(),
        }));
        return;
      }
      if (usable.length === 1) {
        await matchSheet(id, uid, parsed.id, usable[0]!.name);
        return;
      }
      patchMsg(id, uid, (m) => ({
        ...m,
        content: `${file.name} has ${usable.length} sheets with customers. Which one do you want to review?`,
        sheetPick: { fileId: parsed.id },
      }));
    } catch (e) {
      failMsg(id, uid, e);
    }
  }

  const pickSheet = (fileId: string, sheetName: string) => {
    if (!active || busy) return;
    const uid = newId();
    appendMsg(active.id, { role: "assistant", content: "", uid });
    void matchSheet(active.id, uid, fileId, sheetName);
  };

  const decide = (msgIndex: number, ok: boolean) => {
    if (!active) return;
    const m = active.messages[msgIndex];
    if (!m?.confirm || m.confirm.state !== "pending") return;
    update(active.id, (c) => ({
      ...c,
      messages: c.messages.map((x, i) =>
        i === msgIndex && x.confirm
          ? { ...x, confirm: { ...x.confirm, state: ok ? "done" : "cancelled" } }
          : x,
      ),
    }));
    if (ok) void ask("", { id: m.confirm.id, args: m.confirm.args });
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the AI assistant"
        className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90"
      >
        <Bot className="h-6 w-6" />
      </button>
    );

  const panel = full
    ? "fixed inset-3 z-50 md:inset-6"
    : "fixed bottom-5 right-5 z-50 h-[min(720px,calc(100vh-40px))] w-[min(460px,calc(100vw-40px))]";
  return (
    <div
      className={`${panel} flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl`}
    >
      <div className="flex items-center gap-2 bg-primary px-4 py-3 text-primary-foreground">
        <BrainCircuit className="h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Rare Global AI</p>
          <p className="truncate text-[11px] opacity-80">
            {active?.workingSet?.ids.length
              ? `Working set: ${active.workingSet.ids.length} clients · ${active.workingSet.label}`
              : "Collections Intelligence Center"}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${home.isError ? "bg-white/20" : "bg-emerald-400/25 text-emerald-100"}`}
        >
          {home.isError ? "Offline" : "Online"}
        </span>
        <button
          type="button"
          title="History"
          onClick={() => setShowHistory((v) => !v)}
          className="rounded p-1.5 hover:bg-white/15"
        >
          <History className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="New conversation"
          onClick={newConvo}
          className="rounded p-1.5 hover:bg-white/15"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={full ? "Exit full screen" : "Full screen"}
          onClick={() => setFull((v) => !v)}
          className="rounded p-1.5 hover:bg-white/15"
        >
          {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          title="Close"
          onClick={() => setOpen(false)}
          className="rounded p-1.5 hover:bg-white/15"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {showHistory ? (
        <div className="flex-1 overflow-y-auto p-3">
          {convos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conversations yet.</p>
          ) : null}
          {convos.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveId(c.id);
                setShowHistory(false);
              }}
              className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted ${c.id === activeId ? "bg-secondary" : ""}`}
            >
              <p className="truncate font-medium">{c.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(c.updated).toLocaleString("en-PH")}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!active?.messages.length ? (
            <AssistantHome
              data={home.data}
              loading={home.isLoading}
              failed={home.isError}
              onAsk={(q) => void ask(q)}
              onNavigate={(to) => void navigate({ to: to as "/" })}
            />
          ) : null}
          {active?.messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "w-full text-sm"
                }
              >
                {m.tools?.length ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {m.tools.map((t, k) => (
                      <span
                        key={k}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${t.status === "error" ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground"}`}
                        title={t.summary}
                      >
                        {t.status === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : null}
                        {TOOL_LABEL[t.id] ?? t.id}
                        {t.status === "error" ? " (failed)" : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.role === "assistant" ? (
                  <div className="assistant-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content || (busy && i === active.messages.length - 1 ? "…" : "")}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                )}
                {m.confirm ? (
                  <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                    <p className="text-xs font-semibold">Confirmation needed: {m.confirm.id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{m.confirm.description}</p>
                    <pre className="mt-1 max-h-32 overflow-auto text-[11px]">
                      {JSON.stringify(m.confirm.args, null, 2)}
                    </pre>
                    {m.confirm.state === "pending" ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => decide(i, true)}
                          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => decide(i, false)}
                          className="rounded-md border border-border px-3 py-1 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs font-semibold">
                        {m.confirm.state === "done" ? "Confirmed" : "Cancelled"}
                      </p>
                    )}
                  </div>
                ) : null}
                {m.sheetPick ? (
                  <ListBoundary>
                    <SheetPicker
                      fileId={m.sheetPick.fileId}
                      onPick={(name) => pickSheet(m.sheetPick!.fileId, name)}
                    />
                  </ListBoundary>
                ) : null}
                {m.review && active ? (
                  <ListBoundary>
                    <ListReview
                      reviewId={m.review.id}
                      sessionId={active.id}
                      getUserName={userName}
                    />
                  </ListBoundary>
                ) : null}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {!showHistory && !active?.messages.length ? (
        <div className="border-t border-border px-3 pt-2">
          <p className="mb-1 text-[11px] text-muted-foreground">Example commands</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_COMMANDS.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy}
                onClick={() => void ask(c.prompt)}
                className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium hover:bg-muted/70 disabled:opacity-50"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void ask(input.trim());
        }}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
        <button
          type="button"
          title="Attach an Excel or CSV list of customers"
          aria-label="Attach a customer list"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted disabled:opacity-40"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim()) void ask(input.trim());
            }
          }}
          rows={1}
          placeholder="Ask anything or give a command…"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
