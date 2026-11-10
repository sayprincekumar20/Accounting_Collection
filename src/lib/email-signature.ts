// Fixed email signature and quoted previous message for replies sent from the dashboard.
export const SIGNATURE_TEXT = [
  "Best regards,",
  "Grace",
  "Accounts Receivable Team",
  "Rare Global Food Trading Corp.",
  "grace.accounting@rareglobalfood.com",
].join("\n");

export const SIGNATURE_HTML =
  '<div data-rgf-signature style="margin-top:16px;color:#374151;font-size:13px;line-height:1.5">' +
  "Best regards,<br><strong>Grace</strong><br>Accounts Receivable Team<br>Rare Global Food Trading Corp.<br>" +
  '<a href="mailto:grace.accounting@rareglobalfood.com">grace.accounting@rareglobalfood.com</a></div>';

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML (e.g. a client's email body) -> readable plain text: line breaks kept, tags removed, entities decoded. */
export function htmlToText(input: string): string {
  if (!/<[a-z!/][^>]*>/i.test(input)) return input;
  return input
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text -> simple HTML (line breaks kept). */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

export interface QuotedMessage {
  from: string;
  at?: string; // display date, e.g. "Mon, Nov 9, 2026, 2:17 PM" (optional)
  text: string;
}

/** Adds the signature (once) and, for replies, the quoted previous message: { html, text }. */
export function composeEmail(
  bodyHtml: string,
  bodyText: string,
  quote?: QuotedMessage | null,
): { html: string; text: string } {
  const hasSig =
    bodyHtml.includes("data-rgf-signature") ||
    bodyText.includes("Accounts Receivable Team\nRare Global Food");
  let html = (bodyHtml.trim() || textToHtml(bodyText.trim())) + (hasSig ? "" : SIGNATURE_HTML);
  let text = bodyText.trim() + (hasSig ? "" : "\n\n" + SIGNATURE_TEXT);
  if (quote && quote.text.trim()) {
    const q = htmlToText(quote.text).trim().slice(0, 4000);
    html +=
      '<div style="margin-top:16px;color:#6b7280;font-size:13px">' +
      (quote.at ? "On " + escapeHtml(quote.at) + ", " : "") +
      escapeHtml(quote.from) +
      ' wrote:</div><blockquote style="margin:6px 0 0;padding-left:12px;border-left:3px solid #d1d5db;color:#6b7280">' +
      textToHtml(q) +
      "</blockquote>";
    text +=
      `\n\n${quote.at ? `On ${quote.at}, ` : ""}${quote.from} wrote:\n` +
      q
        .split("\n")
        .map((l) => "> " + l)
        .join("\n");
  }
  return { html, text };
}

/** Split a To / Cc / Bcc value into addresses (comma, semicolon or space separated). */
export function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}
export const isEmailAddress = (v: string) =>
  /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i.test(v);
