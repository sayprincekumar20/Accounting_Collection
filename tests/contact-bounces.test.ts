import { describe, expect, it } from "vitest";
import { bounceIssue, latestBounces } from "../src/lib/contact-bounces";

const NOW = Date.UTC(2026, 10, 12);
const b = (o: Record<string, unknown>) => ({
  client_id: "A___1",
  address: "a@x.com",
  reason: "Address not found (the mailbox does not exist)",
  bounced_at: "2026-11-12T05:01:43.000Z",
  ...o,
});

describe("email bounces in Contacts to Fix", () => {
  it("flags a client whose current email is the address that bounced", () => {
    const m = latestBounces([b({})], NOW);
    expect(bounceIssue("A@X.com ", m.get("A___1"))).toBe(
      "Email bounced: Address not found (the mailbox does not exist) (2026-11-12)",
    );
  });
  it("stops flagging once the email was corrected", () => {
    const m = latestBounces([b({})], NOW);
    expect(bounceIssue("new@x.com", m.get("A___1"))).toBeNull();
  });
  it("keeps only the latest bounce per client and ignores old ones", () => {
    const m = latestBounces(
      [
        b({ bounced_at: "2026-11-01T00:00:00Z", address: "old@x.com" }),
        b({ bounced_at: "2026-11-10T00:00:00Z", address: "new@x.com" }),
        b({ client_id: "B___1", bounced_at: "2026-01-01T00:00:00Z" }),
        b({ client_id: "", address: "nobody@x.com" }),
      ],
      NOW,
    );
    expect(m.get("A___1")!["address"]).toBe("new@x.com");
    expect(m.has("B___1")).toBe(false);
    expect(m.size).toBe(1);
  });
  it("no bounce, no issue", () => {
    expect(bounceIssue("a@x.com", undefined)).toBeNull();
  });
});
