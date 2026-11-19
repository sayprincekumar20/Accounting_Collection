// AI assistant: the real processing stages of an uploaded list, shown under the message.
// Each step is marked when it actually starts and ends (no estimated percentage).
export type StepState = "pending" | "active" | "done" | "failed";
export type StepKey = "uploaded" | "processing" | "analysis" | "results" | "completed";
export interface ProgressStep {
  key: StepKey;
  label: string;
  state: StepState;
  started?: number;
  ended?: number;
  detail?: string;
}

export const STEP_LABELS: Record<StepKey, string> = {
  uploaded: "File uploaded",
  processing: "File processing",
  analysis: "Data analysis",
  results: "Results being prepared",
  completed: "Completed",
};

export function newSteps(keys: StepKey[]): ProgressStep[] {
  return keys.map((key) => ({ key, label: STEP_LABELS[key], state: "pending" }));
}

/** Set one step's state; "active" records the start, "done" / "failed" the end. */
export function markStep(
  steps: ProgressStep[],
  key: StepKey,
  state: StepState,
  opts: { detail?: string; now?: number; started?: number; ended?: number } = {},
): ProgressStep[] {
  const now = opts.now ?? Date.now();
  return steps.map((s) => {
    if (s.key !== key) return s;
    const next: ProgressStep = { ...s, state };
    if (opts.detail !== undefined) next.detail = opts.detail;
    if (state === "active") next.started = opts.started ?? now;
    if (state === "done" || state === "failed") {
      next.started = opts.started ?? s.started ?? now;
      next.ended = opts.ended ?? now;
    }
    if (key === "completed") next.label = state === "failed" ? "Failed" : STEP_LABELS.completed;
    return next;
  });
}

/** Something went wrong: the running step fails, and so does the final step (with the reason). */
export function failActive(
  steps: ProgressStep[],
  reason: string,
  now = Date.now(),
): ProgressStep[] {
  let out = steps;
  for (const s of steps) if (s.state === "active") out = markStep(out, s.key, "failed", { now });
  return markStep(out, "completed", "failed", { detail: reason.slice(0, 200), now });
}

/** After a page reload nothing is running any more: a step left "active" is shown as interrupted. */
export function interruptStale(steps: ProgressStep[] | undefined): ProgressStep[] | undefined {
  if (!steps?.some((s) => s.state === "active")) return steps;
  return failActive(steps, "Interrupted (the page was reloaded)");
}

export function durationLabel(ms: number): string {
  if (!(ms >= 0)) return "";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${sec % 60} s`;
}

export const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
