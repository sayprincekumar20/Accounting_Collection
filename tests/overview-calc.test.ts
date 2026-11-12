import { describe, expect, it } from "vitest";
import { promiseForCall, queueBreakdown } from "../src/lib/overview-calc";

describe("queueBreakdown (Overview 'In the queue')", () => {
  it("counts only what is still waiting; sent and skipped are shown apart; stale ignored", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({
        queue_status: "WAITING_APPROVAL",
        collection_amount: 100,
      })),
      { queue_status: "WAITING_QUOTA", collection_amount: 50 },
      { queue_status: "SENT", collection_amount: 999 },
      { queue_status: "SKIPPED_MULTIBRANCH", collection_amount: 999 },
      { queue_status: "SKIPPED_SALESPERSON", collection_amount: 999 },
      { queue_status: "STALE", collection_amount: 999 },
      { queue_status: "", collection_amount: 999 },
    ];
    expect(queueBreakdown(rows)).toEqual({ waiting: 4, waitingAmount: 350, sent: 1, skipped: 2 });
  });
});

describe("promiseForCall (Voice 'Promises to pay - confirmed on a call')", () => {
  const call = {
    client_id: "A___1",
    startedAt: "2026-11-11T06:04:00Z",
    endedAt: "2026-11-11T06:05:30Z",
  };
  const p = (o: Record<string, string>) => ({
    client_id: "A___1",
    channel: "VOICE",
    recorded_at: "2026-11-11T06:05:00Z",
    ...o,
  });
  it("a promise saved during the call or right after it belongs to the call", () => {
    expect(promiseForCall([p({})], call)).toBeTruthy();
    expect(promiseForCall([p({ recorded_at: "2026-11-11T06:15:00Z" })], call)).toBeTruthy();
  });
  it("an older promise, another channel or another client does not", () => {
    expect(promiseForCall([p({ recorded_at: "2026-11-04T06:05:00Z" })], call)).toBeUndefined();
    expect(promiseForCall([p({ channel: "EMAIL" })], call)).toBeUndefined();
    expect(promiseForCall([p({ client_id: "B___1" })], call)).toBeUndefined();
    expect(promiseForCall([p({ recorded_at: "2026-11-11T07:00:00Z" })], call)).toBeUndefined();
  });
});
