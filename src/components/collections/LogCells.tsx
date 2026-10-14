// Shared table cells for the channel log pages (Email, SMS, WhatsApp, Voice), so every
// channel shows status, summary, promise date and escalation the same way.

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** Decode HTML entities (Gmail snippets arrive as "I&#39;ve"), drop quoted replies, tidy spaces. */
export function cleanText(raw: string | null | undefined): string {
  let s = String(raw || "");
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    const k = code.toLowerCase();
    if (ENTITY[k]) return ENTITY[k];
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
  // Cut the quoted previous message: "On Tue, 13 Oct 2026 ... wrote:" and "> ..." lines.
  s = s.split(/\s+On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s/)[0] ?? "";
  s = s.split(/\n>/)[0] ?? "";
  return s.replace(/\s+/g, " ").trim();
}

function dayTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const REASON_LABEL: Record<string, string> = {
  payment_promise: "Promise to pay",
  investigation_hold: "On hold, verifying",
  client_unavailable: "Client unavailable",
  business_closed_pending_review: "Business closed, review",
};

export type LastFrom = "client" | "us" | "";

/**
 * Conversation status that does not flip back and forth: it says whether the client has
 * replied at all, and whether the last word in the thread is theirs (needs an answer) or ours.
 */
export function ConversationStatus({
  clientReplies,
  lastFrom,
  bounced = false,
  failed = false,
}: {
  clientReplies: number;
  lastFrom: LastFrom;
  bounced?: boolean | undefined;
  failed?: boolean | undefined;
}) {
  let label: string;
  let tone: string;
  if (failed) {
    // Gmail refused to send it (no thread exists).
    label = "Send failed";
    tone = "bg-destructive/12 text-destructive border-destructive/30";
  } else if (bounced && clientReplies === 0) {
    // The reminder never arrived: the address on file is wrong or blocked.
    label = "Email bounced, check address";
    tone = "bg-destructive/12 text-destructive border-destructive/30";
  } else if (clientReplies === 0) {
    label = "No reply yet";
    tone = "bg-muted text-muted-foreground border-border";
  } else if (lastFrom === "client") {
    label = "Client replied, needs answer";
    tone = "bg-warning/18 text-warning border-warning/40";
  } else {
    label = "Client replied, answered";
    tone = "bg-success/12 text-success border-success/30";
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
      >
        {label}
      </span>
      {clientReplies > 0 ? (
        <span className="text-[10px] text-muted-foreground">
          {clientReplies} {clientReplies === 1 ? "reply" : "replies"} from client
        </span>
      ) : null}
    </span>
  );
}

/** Two-line summary: what the client last said, or else what we last sent. */
export function SummaryCell({
  clientText,
  ourText,
}: {
  clientText?: string | undefined;
  ourText?: string | undefined;
}) {
  const client = cleanText(clientText);
  const ours = cleanText(ourText);
  const who = client ? "Client" : ours ? "Sent" : "";
  const text = client || ours;
  if (!text) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <p
      className="line-clamp-2 max-w-[260px] text-xs leading-snug text-muted-foreground"
      title={text}
    >
      <span className="font-semibold text-foreground">{who}: </span>
      {text}
    </p>
  );
}

export function PromiseCell({
  promise,
}: {
  promise?: { promise_date: string; reason: string } | undefined;
}) {
  if (!promise) return <span className="text-xs text-muted-foreground">—</span>;
  const d = new Date(promise.promise_date);
  const date = isNaN(d.getTime())
    ? promise.promise_date
    : d.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
  return (
    <span className="inline-flex flex-col items-start gap-0.5 whitespace-nowrap">
      <span className="rounded-full bg-success/12 px-2.5 py-0.5 text-[11px] font-semibold text-success">
        {date}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {REASON_LABEL[promise.reason] || promise.reason}
      </span>
    </span>
  );
}

/** Escalation shown as a clear flag, when it happened, and the reason (two lines, full text on hover). */
export function EscalatedCell({
  escalation,
}: {
  escalation?: { reason: string; recorded_at: string } | undefined;
}) {
  if (!escalation) return <span className="text-xs text-muted-foreground">—</span>;
  const reason = cleanText(escalation.reason);
  return (
    <span className="inline-flex max-w-[220px] flex-col items-start gap-0.5" title={reason}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-2.5 py-0.5 text-[11px] font-semibold text-destructive">
        Escalated
        {dayTime(escalation.recorded_at) ? (
          <span className="font-normal">{dayTime(escalation.recorded_at)}</span>
        ) : null}
      </span>
      {reason ? (
        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {reason}
        </span>
      ) : null}
    </span>
  );
}

/** WhatsApp-style delivery ticks for a message we sent (Twilio status). */
export function ReadTicks({
  status,
  className = "",
}: {
  status?: string | undefined;
  className?: string;
}) {
  const s = String(status || "").toLowerCase();
  if (s === "failed" || s === "undelivered") {
    return (
      <span
        className={`text-[11px] font-semibold text-destructive ${className}`}
        title="Not delivered"
      >
        Not delivered
      </span>
    );
  }
  if (s === "queued" || s === "accepted" || s === "sending" || s === "scheduled") {
    return (
      <svg
        viewBox="0 0 16 16"
        className={`h-3.5 w-3.5 text-[#8696a0] ${className}`}
        aria-label="Sending"
      >
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 4.5V8l2.2 1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const read = s === "read";
  const double = read || s === "delivered";
  const color = read ? "text-[#53bdeb]" : "text-[#8696a0]";
  const label = read ? "Read" : double ? "Delivered" : "Sent";
  return (
    <svg viewBox="0 0 18 12" className={`h-3 w-[18px] ${color} ${className}`} aria-label={label}>
      <title>{label}</title>
      <path
        d="M1 6.5l3.2 3.2L11 2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {double ? (
        <path
          d="M6.8 9.7L7.6 10.5 14.6 2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
