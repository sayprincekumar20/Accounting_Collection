import { describe, expect, it } from "vitest";
import {
  composeEmail,
  isEmailAddress,
  SIGNATURE_TEXT,
  splitAddresses,
} from "../src/lib/email-signature";

describe("proper email: signature and quoted message", () => {
  it("adds the fixed signature once (HTML and text)", () => {
    const r = composeEmail("<p>Hello</p>", "Hello");
    expect(r.html).toContain("data-rgf-signature");
    expect(r.html).toContain("Accounts Receivable Team");
    expect(r.text.endsWith(SIGNATURE_TEXT)).toBe(true);
    const again = composeEmail(r.html, r.text);
    expect(again.html.match(/data-rgf-signature/g)).toHaveLength(1);
  });
  it("builds HTML from plain text when there is no formatted body", () => {
    expect(composeEmail("", "Line 1\nLine 2 <b>").html).toContain("Line 1<br>Line 2 &lt;b&gt;");
  });
  it("quotes the client's previous message (escaped) below the signature", () => {
    const r = composeEmail("<p>Thanks</p>", "Thanks", {
      from: "Rishi <TEST>",
      text: "Will pay Friday\n<script>x</script>",
    });
    expect(r.html).toContain("Rishi &lt;TEST&gt; wrote:");
    expect(r.html).toContain("<blockquote");
    expect(r.html).not.toContain("<script>");
    expect(r.html.indexOf("data-rgf-signature")).toBeLessThan(r.html.indexOf("<blockquote"));
    expect(r.text).toContain("> Will pay Friday");
  });
});

describe("recipient chips helpers", () => {
  it("splits and validates addresses", () => {
    expect(splitAddresses("a@x.co, b@y.com; c@z.ph d@w.org")).toEqual([
      "a@x.co",
      "b@y.com",
      "c@z.ph",
      "d@w.org",
    ]);
    expect(isEmailAddress("pk8543264@gmail.com")).toBe(true);
    expect(isEmailAddress("not-an-email")).toBe(false);
  });
});
