// One filter bar used by Overview, Clients, Queue, Reports and the channel pages. Each page keeps its OWN
// selection for the browser session (its "scope"): the pages give Status and Period different meanings
// (a channel on Overview, a due date on Clients…), so one shared selection used to empty other lists.
import { useEffect, useState, type ReactNode } from "react";

export type StatusFilter =
  | "all"
  | "no_reply"
  | "replied"
  | "needs_answer"
  | "answered"
  | "promised"
  | "escalated"
  | "reached"
  | "not_reached"
  | "bounced";
export type RangeFilter = "all" | "today" | "7d" | "30d";
export type SourceFilter = "all" | "weekly" | "cliq" | "retry" | "untagged";

export interface LogFilterState {
  q: string;
  /** One of StatusFilter on channel tabs; pages may use their own values (see statusOptions). */
  status: StatusFilter | (string & {});
  range: RangeFilter;
  source: SourceFilter;
}

const DEFAULT: LogFilterState = { q: "", status: "all", range: "all", source: "all" };
const KEY = "rgf-log-filters";
const EVT = "rgf-log-filters-change";

function read(scope: string): LogFilterState {
  try {
    return {
      ...DEFAULT,
      ...(JSON.parse(sessionStorage.getItem(`${KEY}:${scope}`) || "{}") as Partial<LogFilterState>),
    };
  } catch {
    return DEFAULT;
  }
}

/** This page's filter state, kept for the browser session (one scope per page). */
export function useLogFilters(
  scope: string,
): [LogFilterState, (patch: Partial<LogFilterState>) => void, () => void] {
  const [state, setState] = useState<LogFilterState>(DEFAULT);
  useEffect(() => {
    setState(read(scope));
    const onChange = (e: Event) => {
      if ((e as CustomEvent<string>).detail === scope) setState(read(scope));
    };
    window.addEventListener(EVT, onChange);
    return () => {
      window.removeEventListener(EVT, onChange);
    };
  }, [scope]);
  const update = (patch: Partial<LogFilterState>) => {
    const next = { ...read(scope), ...patch };
    try {
      sessionStorage.setItem(`${KEY}:${scope}`, JSON.stringify(next));
    } catch {
      // storage unavailable: still filter this page
    }
    setState(next);
    window.dispatchEvent(new CustomEvent(EVT, { detail: scope }));
  };
  return [state, update, () => update(DEFAULT)];
}

/** What a row exposes so the shared rules can filter it. */
export interface FilterableRow {
  name: string;
  contact?: string | undefined;
  extra?: string | undefined; // email, phone, invoice numbers… anything searchable
  clientReplies?: number | undefined;
  lastFrom?: string | undefined; // "client" | "us"
  reached?: boolean | undefined; // voice: call connected
  bounced?: boolean | undefined; // email: reminder bounced (wrong/blocked address)
  hasPromise?: boolean | undefined;
  hasEscalation?: boolean | undefined;
  lastActivity?: string | undefined;
  source?: string | undefined; // trigger_source: WEEKLY_AUTO, DAILY_CONTINUATION, MANUAL_RUN, CLIQ_CALL, RETRY
}

/** Group the stored trigger_source values into the filter's options. */
export function sourceGroup(source: string | undefined): Exclude<SourceFilter, "all"> {
  const s = String(source || "").toUpperCase();
  if (s === "CLIQ_CALL") return "cliq";
  if (s === "RETRY") return "retry";
  if (s === "WEEKLY_AUTO" || s === "DAILY_CONTINUATION" || s === "MANUAL_RUN") return "weekly";
  return "untagged";
}

export function sourceLabel(source: string | undefined, requestedBy?: string): string {
  switch (sourceGroup(source)) {
    case "cliq":
      return requestedBy ? `Manual · ${requestedBy}` : "Manual";
    case "retry":
      return "Retry";
    case "weekly":
      return String(source).toUpperCase() === "DAILY_CONTINUATION"
        ? "Weekly · Thu/Fri batch"
        : "Weekly run";
    default:
      return "—";
  }
}

export function matchesLogFilters(r: FilterableRow, f: LogFilterState): boolean {
  if (f.q) {
    const hay = `${r.name} ${r.contact || ""} ${r.extra || ""}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase().trim())) return false;
  }
  const replies = r.clientReplies ?? 0;
  switch (f.status) {
    case "no_reply":
      if (replies > 0) return false;
      break;
    case "replied":
      if (replies === 0) return false;
      break;
    case "needs_answer":
      if (!(replies > 0 && r.lastFrom === "client")) return false;
      break;
    case "answered":
      if (!(replies > 0 && r.lastFrom !== "client")) return false;
      break;
    case "promised":
      if (!r.hasPromise) return false;
      break;
    case "escalated":
      if (!r.hasEscalation) return false;
      break;
    case "reached":
      if (!r.reached) return false;
      break;
    case "not_reached":
      if (r.reached) return false;
      break;
    case "bounced":
      if (!r.bounced) return false;
      break;
    default:
      break;
  }
  if (f.range !== "all") {
    const t = new Date(r.lastActivity || "").getTime();
    if (isNaN(t)) return false;
    const now = new Date();
    const since =
      f.range === "today"
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        : now.getTime() - (f.range === "7d" ? 7 : 30) * 86400000;
    if (t < since) return false;
  }
  if (f.source !== "all" && sourceGroup(r.source) !== f.source) return false;
  return true;
}

const TEXT_STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "no_reply", label: "No reply yet" },
  { value: "replied", label: "Client replied" },
  { value: "needs_answer", label: "Needs answer" },
  { value: "answered", label: "Answered" },
  { value: "promised", label: "Promise to pay" },
  { value: "escalated", label: "Escalated" },
  { value: "bounced", label: "Not delivered (bounced or failed)" },
];
const VOICE_STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All outcomes" },
  { value: "reached", label: "Reached (call connected)" },
  { value: "not_reached", label: "Not reached" },
  { value: "promised", label: "Promise to pay" },
  { value: "escalated", label: "Escalated" },
];

export function LogFilterBar({
  filters,
  onChange,
  onClear,
  shown,
  total,
  variant = "text",
  statusOptions,
  hideStatus = false,
  hideSource = false,
  hideRange = false,
  rangeLabel,
  searchPlaceholder,
  children,
}: {
  filters: LogFilterState;
  onChange: (patch: Partial<LogFilterState>) => void;
  onClear: () => void;
  shown: number;
  total: number;
  variant?: "text" | "voice";
  /** Page-specific status options (first one should be the "all" option). */
  statusOptions?: { value: string; label: string }[] | undefined;
  hideStatus?: boolean | undefined;
  hideSource?: boolean | undefined;
  /** Hide the Period select (a page with its own date filter). */
  hideRange?: boolean | undefined;
  /** Page-specific controls shown in the bar. */
  children?: ReactNode;
  /** What the period filters on, shown as the first option (e.g. "Any run date"). */
  rangeLabel?: string | undefined;
  searchPlaceholder?: string | undefined;
}) {
  const statuses = statusOptions ?? (variant === "voice" ? VOICE_STATUSES : TEXT_STATUSES);
  const foreign = !hideStatus && !statuses.some((s) => s.value === filters.status);
  useEffect(() => {
    if (foreign) onChange({ status: "all" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreign]);
  const active =
    filters.q ||
    (!hideStatus && filters.status !== "all") ||
    (!hideRange && filters.range !== "all") ||
    (!hideSource && filters.source !== "all");
  const select =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <div className="surface-card flex flex-wrap items-center gap-2.5 p-3">
      <input
        type="search"
        value={filters.q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder={searchPlaceholder || "Search client, contact, email, phone…"}
        aria-label="Search"
        className={`${select} min-w-[220px] flex-1`}
      />
      {hideStatus ? null : (
        <select
          aria-label="Status"
          value={statuses.some((s) => s.value === filters.status) ? filters.status : "all"}
          onChange={(e) => onChange({ status: e.target.value as StatusFilter })}
          className={select}
        >
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      {hideRange ? null : (
        <select
          aria-label="Period"
          value={filters.range}
          onChange={(e) => onChange({ range: e.target.value as RangeFilter })}
          className={select}
        >
          <option value="all">{rangeLabel || "Any time"}</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      )}
      {children}
      {hideSource ? null : (
        <select
          aria-label="Source"
          value={filters.source}
          onChange={(e) => onChange({ source: e.target.value as SourceFilter })}
          className={select}
        >
          <option value="all">All sources</option>
          <option value="weekly">Weekly run (auto)</option>
          <option value="cliq">Manual (dashboard / assistant)</option>
          <option value="retry">Same-day retry</option>
          <option value="untagged">Not tagged (before 14 Oct)</option>
        </select>
      )}
      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
        Showing {shown} of {total}
      </span>
      {active ? (
        <button
          type="button"
          onClick={onClear}
          className="h-9 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-muted"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/** The filter scope of a page address ("/sms" -> "sms", "/" -> "overview"). */
export function filterScopeForPath(path: string): string {
  const p = path.split(/[?#]/)[0]!.replace(/\/+$/, "");
  if (!p) return "overview";
  return p.slice(1).split("/")[0] || "overview";
}

/** Set a page's filters from outside it (the AI assistant's navigate action), by that page's address. */
export function setLogFilters(path: string, patch: Partial<LogFilterState>): void {
  const scope = filterScopeForPath(path);
  const next = { ...read(scope), ...patch };
  try {
    sessionStorage.setItem(`${KEY}:${scope}`, JSON.stringify(next));
  } catch {
    // storage unavailable
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: scope }));
}
