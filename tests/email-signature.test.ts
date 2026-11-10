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

describe("quoted message from an HTML email", () => {
  it("quotes readable text, not HTML code", async () => {
    const { composeEmail, htmlToText } = await import("../src/lib/email-signature");
    expect(htmlToText('<div dir="auto">okay i will pay you on 5 nov</div><div><br></div>')).toBe(
      "okay i will pay you on 5 nov",
    );
    expect(htmlToText("Tom &amp; Co<br>line 2")).toBe("Tom & Co\nline 2");
    const r = composeEmail("<p>Thanks</p>", "Thanks", {
      from: "ZOHO FORM TEST ACCOUNT",
      text: '<div dir="auto">okay i will pay you on 5 nov</div><div><br></div>',
    });
    expect(r.html).not.toContain("&lt;div");
    expect(r.html).toContain("okay i will pay you on 5 nov");
    expect(r.text).toContain("> okay i will pay you on 5 nov");
  });
});
