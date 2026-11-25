import { describe, expect, it } from "vitest";
import { isToDecide, type ReviewRow } from "../src/lib/dv";

const row = (action: string, decision = "Pending", auto: string | null = null) =>
  ({ action, decision, auto_applied: auto }) as unknown as ReviewRow;

describe("rows to decide (same rule as the Reviews list)", () => {
  it("counts pending value changes only", () => {
    // FRUS CORP DV-24: Business Style, Owner Name, Phone, TIN, Type of Business Organization
    const rows = [
      row("ATTACH"),
      row("ATTACH"),
      row("FILL"),
      row("CORRECT"),
      row("FILL"),
      row("FILL"),
      row("FILL"),
      row("MATCH"),
      row("MATCH"),
      row("MATCH"),
    ];
    expect(rows.filter(isToDecide)).toHaveLength(5);
  });
  it("drops decided and automatically written rows", () => {
    expect(isToDecide(row("FILL", "Approve"))).toBe(false);
    expect(isToDecide(row("FILL", "Pending", "Applied"))).toBe(false);
  });
});
