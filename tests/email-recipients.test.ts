import { describe, expect, it } from "vitest";
import { getReplyAllCcRecipients, parseEmailRecipients } from "../src/lib/email-recipients";

describe("email recipient parsing", () => {
  it("parses bare and display-name addresses", () => {
    expect(
      parseEmailRecipients(
        '"Doe, Jane" <jane@example.com>, team@example.org; Other <ops@example.net>',
      ),
    ).toEqual(["jane@example.com", "team@example.org", "ops@example.net"]);
  });

  it("deduplicates addresses without regard to case", () => {
    expect(parseEmailRecipients("person@example.com, PERSON@example.com")).toEqual([
      "PERSON@example.com",
    ]);
  });

  it("accepts an empty optional recipient field", () => {
    expect(parseEmailRecipients("  ")).toEqual([]);
  });

  it("builds Reply All Cc without the sender account or duplicate To recipients", () => {
    expect(
      getReplyAllCcRecipients({
        toRecipients: ["customer@example.com"],
        headerTo: "finance@example.com, AR <ar@example.com>",
        headerCc: "customer@example.com, manager@example.net",
        businessEmail: "finance@example.com",
        extraCc: ["manager@example.net", "extra@example.org"],
      }),
    ).toEqual(["ar@example.com", "manager@example.net", "extra@example.org"]);
  });

  it("rejects malformed or header-injected addresses", () => {
    expect(() => parseEmailRecipients("person@example.com\r\nBcc: other@example.com")).toThrow(
      "Invalid email address",
    );
  });
});
