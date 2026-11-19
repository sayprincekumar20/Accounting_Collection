import { describe, expect, it } from "vitest";
import {
  durationLabel,
  failActive,
  interruptStale,
  markStep,
  newSteps,
} from "../src/lib/assistant/progress";

describe("assistant progress steps (real stages, no estimates)", () => {
  it("records the real start and end of each step", () => {
    let s = newSteps(["uploaded", "processing", "analysis", "results", "completed"]);
    s = markStep(s, "uploaded", "done", { now: 1000 });
    s = markStep(s, "processing", "active", { now: 1000 });
    s = markStep(s, "processing", "done", { now: 1400, detail: "2 sheets, 30 customers" });
    expect(s[1]).toMatchObject({
      state: "done",
      started: 1000,
      ended: 1400,
      detail: "2 sheets, 30 customers",
    });
    expect(s[2]!.state).toBe("pending");
  });
  it("a failure marks the running step and the final step as failed, with the reason", () => {
    let s = newSteps(["uploaded", "processing", "analysis", "results", "completed"]);
    s = markStep(s, "analysis", "active", { now: 1 });
    s = failActive(s, "Matching failed (500)", 5);
    expect(s.find((x) => x.key === "analysis")).toMatchObject({ state: "failed", ended: 5 });
    expect(s.find((x) => x.key === "completed")).toMatchObject({
      state: "failed",
      label: "Failed",
      detail: "Matching failed (500)",
    });
  });
  it("after a reload a running step is shown as interrupted, never spinning forever", () => {
    const s = markStep(newSteps(["analysis", "completed"]), "analysis", "active", { now: 1 });
    expect(interruptStale(s)!.find((x) => x.key === "completed")!.detail).toContain("Interrupted");
    const done = markStep(newSteps(["completed"]), "completed", "done");
    expect(interruptStale(done)).toBe(done);
  });
  it("durations read naturally", () => {
    expect(durationLabel(420)).toBe("0.4 s");
    expect(durationLabel(12_400)).toBe("12 s");
    expect(durationLabel(65_000)).toBe("1 min 5 s");
  });
});
