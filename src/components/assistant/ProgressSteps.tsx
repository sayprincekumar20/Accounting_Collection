import { useEffect, useState } from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import { durationLabel, type ProgressStep } from "@/lib/assistant/progress";

// The real stages of an uploaded list (File uploaded -> File processing -> Data analysis -> Results being
// prepared -> Completed / Failed). Times are measured, not estimated; the running step counts up live.
export function ProgressSteps({ steps }: { steps: ProgressStep[] }) {
  const running = steps.some((s) => s.state === "active");
  const final = steps.find((s) => s.key === "completed");
  const finished = final?.state === "done";
  const [open, setOpen] = useState(!finished);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [running]);
  useEffect(() => {
    if (finished) setOpen(false);
  }, [finished]);

  const first = steps.find((s) => s.started)?.started;
  const total = final?.ended && first ? final.ended - first : undefined;

  if (finished && !open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline"
      >
        <Check className="h-3 w-3 text-success" />
        Completed{total !== undefined ? ` in ${durationLabel(total)}` : ""} · show steps
      </button>
    );

  return (
    <ol
      className="mt-2 space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"
      aria-label="Processing steps"
    >
      {steps.map((s) => {
        const ms =
          s.state === "active" && s.started
            ? now - s.started
            : s.started && s.ended
              ? s.ended - s.started
              : undefined;
        return (
          <li key={s.key} className="flex items-start gap-2" data-state={s.state}>
            <span className="mt-0.5 shrink-0">
              {s.state === "done" ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : s.state === "active" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : s.state === "failed" ? (
                <X className="h-3.5 w-3.5 text-destructive" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-muted-foreground/50" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={
                  s.state === "pending"
                    ? "text-muted-foreground"
                    : s.state === "failed"
                      ? "font-semibold text-destructive"
                      : "font-semibold"
                }
              >
                {s.label}
              </span>
              {s.detail ? <span className="text-muted-foreground"> · {s.detail}</span> : null}
            </span>
            {ms !== undefined && ms >= 100 ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {durationLabel(ms)}
              </span>
            ) : null}
          </li>
        );
      })}
      {finished ? (
        <li>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
            className="text-[11px] text-muted-foreground hover:underline"
          >
            hide steps
          </button>
        </li>
      ) : null}
    </ol>
  );
}
