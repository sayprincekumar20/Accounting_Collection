import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { HomeData, HomePriority } from "./home-data";

// Home screen of the AI assistant ("Collections Intelligence Center"): greeting, live numbers, today's
// priorities and the open workflow problems. Data comes from /api/assistant/home (read-only).
const PAGE_FOR: Record<string, { to: string; label: string }> = {
  escalations: { to: "/escalations", label: "Review cases" },
  promises: { to: "/promises", label: "Open promises" },
  approvals: { to: "/approvals", label: "Open approvals" },
};

const BADGE: Record<HomePriority["tone"], string> = {
  danger: "bg-destructive/12 text-destructive",
  warning: "bg-warning/20 text-foreground",
  info: "bg-secondary text-secondary-foreground",
  ok: "bg-muted text-muted-foreground",
};

const greeting = () => {
  const h = (new Date().getUTCHours() + 8) % 24; // Manila
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const num = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-PH"));

interface Props {
  data: HomeData | undefined;
  loading: boolean;
  failed: boolean;
  onAsk: (text: string) => void;
  onNavigate: (to: string) => void;
}

export function AssistantHome({ data, loading, failed, onAsk, onNavigate }: Props) {
  const [showHealth, setShowHealth] = useState(false);
  const s = data?.stats;
  const urgent = data?.detail.health.urgent ?? 0;
  const issuesTone =
    (s?.workflow_issues ?? 0) === 0
      ? ""
      : urgent > 0
        ? "text-destructive"
        : "text-[color:var(--warning)]";

  const tiles: {
    key: string;
    value: number | null | undefined;
    label: string;
    tone: string;
    onClick: () => void;
  }[] = [
    {
      key: "overdue",
      value: s?.overdue_accounts,
      label: "Overdue accounts",
      tone: "text-destructive",
      onClick: () => onNavigate("/clients"),
    },
    {
      key: "esc",
      value: s?.open_escalations,
      label: "Open escalations",
      tone: "",
      onClick: () => onNavigate("/escalations"),
    },
    {
      key: "prom",
      value: s?.promises_due,
      label: "Promises due",
      tone: "",
      onClick: () => onNavigate("/promises"),
    },
    {
      key: "wf",
      value: s?.workflow_issues,
      label: "Workflow issues",
      tone: issuesTone,
      onClick: () =>
        (s?.workflow_issues ?? 0) > 0
          ? setShowHealth((v) => !v)
          : onAsk("Check the workflows and tell me what needs attention and what to do."),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{greeting()}, AR Team!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          I am monitoring your collections operation. Here is today&apos;s activity.
        </p>
        {failed ? (
          <p className="mt-2 text-xs text-destructive">
            Live numbers are unavailable right now. You can still ask me anything.
          </p>
        ) : null}
        {data?.errors.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Some numbers could not be loaded: {data.errors.join(", ")}.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={t.onClick}
            className="rounded-lg p-1 text-left hover:bg-muted/60"
          >
            <p
              className={`text-3xl font-semibold tabular-nums ${t.tone} ${loading ? "opacity-40" : ""}`}
            >
              {num(t.value)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t.label}</p>
          </button>
        ))}
      </div>

      {showHealth && data?.health_events.length ? (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Open workflow problems
          </p>
          {data.health_events.map((e) => (
            <div key={e.event_key} className="text-sm">
              <p className="flex items-center gap-2 font-medium">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${e.severity === "urgent" ? "bg-destructive" : "bg-warning"}`}
                />
                {e.title}
                <span className="text-[11px] font-normal text-muted-foreground">{e.severity}</span>
              </p>
              <p className="ml-4 text-xs text-muted-foreground">{e.detail}</p>
              {e.suggested_fix ? (
                <p className="ml-4 text-xs">
                  <span className="font-medium">What to do:</span> {e.suggested_fix}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm font-semibold">Today&apos;s priorities</p>
        {(data?.priorities ?? []).map((p) => {
          const page = PAGE_FOR[p.id];
          return (
            <div key={p.id} className="rounded-xl border border-border p-3">
              <button
                type="button"
                disabled={!p.prompt}
                onClick={() => p.prompt && onAsk(p.prompt)}
                className="block w-full text-left disabled:cursor-default"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{p.title}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[p.tone]}`}
                  >
                    {p.badge}
                  </span>
                </span>
                {p.detail ? (
                  <span className="mt-1 block text-xs text-muted-foreground">{p.detail}</span>
                ) : null}
              </button>
              {page ? (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onNavigate(page.to)}
                    className="inline-flex items-center text-xs font-medium text-destructive hover:underline"
                  >
                    {page.label}
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {!data && loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      </div>

      <p className="border-t border-border pt-4 text-sm font-semibold">
        What would you like me to do?
      </p>
    </div>
  );
}
