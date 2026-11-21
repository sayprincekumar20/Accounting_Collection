import { useState } from "react";
import { History, Sparkles } from "lucide-react";
import { askAssistant } from "@/lib/assistant-ask";

// Escalations module: per issue (customer escalation or system notification) the "Diagnose with AI" button
// and the issue's history (AI diagnosis, actions taken, status changes, resolution; n8n 33_Issue_Log).

interface Line {
  event: string;
  summary: string;
  actor: string;
  at: string;
}
const EVENT_LABEL: Record<string, string> = {
  DIAGNOSIS: "Diagnosis",
  ACTION: "Action",
  STATUS: "Status",
  RESOLUTION: "Resolved",
  NOTE: "Note",
};
const when = (v: string) =>
  v
    ? new Date(v).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

export function IssueTools({
  issueId,
  issueRef,
  kind,
}: {
  issueId: string;
  issueRef: string;
  kind: "ESCALATION" | "SYSTEM";
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [err, setErr] = useState("");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || lines) return;
    try {
      const r = await fetch(`/api/issue-history?id=${encodeURIComponent(issueId)}`);
      const j = (await r.json().catch(() => ({}))) as { items?: Line[]; error?: string };
      if (!r.ok) throw new Error(j.error || "Could not load the history");
      setLines(j.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load the history");
    }
  }

  const label = kind === "SYSTEM" ? "system notification" : "customer escalation";
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => {
            askAssistant(
              `Diagnose ${label} ${issueRef || issueId}: what happened, the likely cause and what to do next.`,
            );
          }}
          className="inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/5"
        >
          <Sparkles className="h-3 w-3" /> Diagnose with AI
        </button>
        <button
          type="button"
          onClick={() => void toggle()}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted"
        >
          <History className="h-3 w-3" /> History
        </button>
      </div>
      {open ? (
        <div
          className="mt-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-xs"
          aria-label="Issue history"
        >
          {err ? (
            <p className="text-destructive">{err}</p>
          ) : !lines ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !lines.length ? (
            <p className="text-muted-foreground">No diagnosis or action recorded yet.</p>
          ) : (
            <ol className="space-y-1">
              {lines.map((l, k) => (
                <li key={k}>
                  <span className="font-semibold">{EVENT_LABEL[l.event] ?? l.event}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {when(l.at)} · {l.actor}
                  </span>
                  <p className="whitespace-pre-line">{l.summary}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
