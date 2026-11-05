import { describe, expect, it } from "vitest";
import { deliveryState, isFailed } from "../src/lib/delivery";

describe("deliveryState (all channels)", () => {
  it("treats provider failure statuses as failed", () => {
    for (const s of [
      "failed",
      "not_delivered",
      "undelivered",
      "cancelled",
      "FAILED",
      "send_failed",
      "rejected",
    ])
      expect(isFailed(s)).toBe(true);
  });
  it("maps delivered / read / sent / pending", () => {
    expect(deliveryState("delivered")).toBe("delivered");
    expect(deliveryState("read")).toBe("read");
    expect(deliveryState("sent")).toBe("sent");
    expect(deliveryState("queued")).toBe("pending");
    expect(deliveryState("")).toBe("");
    expect(isFailed("delivered")).toBe(false);
  });
});
