import { describe, expect, it } from "vitest";
import {
  replyHtmlToText,
  replyHtmlToWhatsAppText,
  sanitizeReplyHtml,
} from "../src/lib/reply-format";

describe("reply formatting", () => {
  it("removes active content and unsupported markup from formatted email", () => {
    const result = sanitizeReplyHtml(
      '<p><strong>Hello</strong><script>alert("bad")</script><img src=x onerror=alert(1)></p>',
    );

    expect(result).toContain("<strong>Hello</strong>");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("onerror");
  });

  it("converts HTML to readable plain text", () => {
    expect(replyHtmlToText("<p>Hello &amp; welcome</p><p>Second line</p>")).toBe(
      "Hello & welcome\nSecond line",
    );
  });

  it("converts supported styles to WhatsApp markup and drops unsupported styles", () => {
    expect(
      replyHtmlToWhatsAppText(
        '<p><strong>Bold</strong> <em>italic</em> <s>strike</s> <u>plain</u> <span style="background-color:#fff2a8">highlight</span></p>',
      ),
    ).toBe("*Bold* _italic_ ~strike~ plain highlight");
  });
});
