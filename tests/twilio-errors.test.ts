import { describe, expect, it } from "vitest";
import { deliveryErrorText } from "../src/lib/twilio-errors";

describe("deliveryErrorText", () => {
  it("translates known WhatsApp / Twilio codes", () => {
    expect(deliveryErrorText(63016)).toBe(
      "Outside WhatsApp's 24-hour window: only approved templates can be delivered (63016)",
    );
    expect(deliveryErrorText("63024")).toBe("This number has no WhatsApp account (63024)");
  });
  it("falls back to Twilio's message, and is empty without an error", () => {
    expect(deliveryErrorText(12345, "Something odd")).toBe("Something odd (12345)");
    expect(deliveryErrorText(null)).toBe("");
    expect(deliveryErrorText(0, "")).toBe("");
  });
});
