import { describe, expect, it } from "vitest";
import { channelMeta } from "../src/lib/collections";

describe("channel badges show the real channel", () => {
  it("matches the stored capitalised names (promise_history, message logs)", () => {
    expect(channelMeta("EMAIL").label).toBe("Email");
    expect(channelMeta("VOICE").label).toBe("Voice");
    expect(channelMeta("SMS").label).toBe("SMS");
    expect(channelMeta("VIBER").label).toBe("Viber");
    expect(channelMeta("whatsapp").label).toBe("WhatsApp");
  });
  it("a callback request is Voice", () => {
    expect(channelMeta("VOICE_CALLBACK").label).toBe("Voice");
  });
  it("an empty or unknown channel is never shown as WhatsApp", () => {
    expect(channelMeta("").label).toBe("Unknown");
    expect(channelMeta("SYSTEM_ERROR").label).toBe("System error");
    expect(channelMeta("").colorVar).toBe("var(--muted-foreground)");
  });
});

import { decodeHtmlEntities } from "../src/lib/html-entities";
describe("Gmail snippets are shown as plain text", () => {
  it("decodes the entities seen on the Overview", () => {
    expect(decodeHtmlEntities("Hi Ma&#39;am/Sir, Good day.")).toBe("Hi Ma'am/Sir, Good day.");
    expect(decodeHtmlEntities("I&#39;ve recorded your promise")).toBe("I've recorded your promise");
    expect(
      decodeHtmlEntities("wasn&#39;t delivered to a &amp; b &lt;x&gt; &quot;q&quot; &#x27;"),
    ).toBe("wasn't delivered to a & b <x> \"q\" '");
    expect(decodeHtmlEntities("50% &unknown; stays")).toBe("50% &unknown; stays");
  });
});
