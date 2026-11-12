import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, PhoneCall } from "lucide-react";
import { getHandlerName } from "@/lib/handler-name";

// "Call again": one call with Grace to this client right now (no text). Two clicks (ask, then confirm), so a
// call is never placed by accident. The result line stays under the button.
export function CallAgainButton({
  clientId,
  clientName,
  compact = false,
}: {
  clientId: string;
  clientName?: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [stage, setStage] = useState<"idle" | "confirm" | "calling" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function call() {
    const who = getHandlerName();
    if (!who) {
      setStage("idle");
      return;
    }
    setStage("calling");
    try {
      const r = await fetch("/api/call-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, requested_by: who }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reply?: string };
      setMsg(j.reply || (r.ok ? "" : `Request failed (${r.status})`));
      setStage(j.ok ? "done" : "error");
      if (j.ok) void qc.invalidateQueries();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong");
      setStage("error");
    }
  }

  const btn = compact
    ? "rounded-md px-2 py-1 text-[11px] font-semibold"
    : "rounded-lg px-2.5 py-1 text-xs font-semibold";
  return (
    <span className="inline-flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
      {stage === "idle" || stage === "done" || stage === "error" ? (
        <button
          type="button"
          onClick={() => setStage("confirm")}
          className={`${btn} inline-flex items-center gap-1 border border-border hover:bg-muted`}
          title="Grace calls this client once, right now (no text)"
        >
          <PhoneCall className="h-3 w-3" />
          Call again
        </button>
      ) : stage === "confirm" ? (
        <span className="inline-flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => void call()}
            className={`${btn} bg-primary text-primary-foreground`}
          >
            Call {clientName ? clientName.slice(0, 24) : "now"}?
          </button>
          <button
            type="button"
            onClick={() => setStage("idle")}
            className={`${btn} border border-border`}
          >
            Cancel
          </button>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Starting the call…
        </span>
      )}
      {msg && (stage === "done" || stage === "error") ? (
        <span
          className={`max-w-xs text-[11px] ${stage === "done" ? "text-success" : "text-destructive"}`}
        >
          {msg}
        </span>
      ) : null}
    </span>
  );
}
