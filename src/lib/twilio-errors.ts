// Plain-language reasons for Twilio / WhatsApp delivery errors shown under a failed message.
const REASONS: Record<string, string> = {
  "63016": "Outside WhatsApp's 24-hour window: only approved templates can be delivered",
  "63024": "This number has no WhatsApp account",
  "63032": "Template not found or not approved for this account",
  "63049": "Meta blocked this message (marketing limits); send it as a Utility template",
  "63018": "WhatsApp rate limit reached for this sender: try again later",
  "63003": "WhatsApp could not reach this number",
  "63112": "Meta disabled the sender account or template",
  "63051": "WhatsApp rejected the message content",
  "21211": "Invalid phone number",
  "21608": "Number not permitted (trial account restriction)",
  "30003": "Phone unreachable or switched off",
  "30005": "Unknown number (does not exist)",
  "30006": "Landline or number that cannot receive messages",
  "30007": "Blocked as spam by the carrier",
  "30008": "Unknown delivery error",
};

/** e.g. "This number has no WhatsApp account (63024)"; '' when there is no error. */
export function deliveryErrorText(code: unknown, message?: unknown): string {
  const c = code == null || code === "" || code === 0 ? "" : String(code);
  if (!c && !message) return "";
  const reason = (c && REASONS[c]) || String(message || "").trim() || "Not delivered";
  return c ? `${reason} (${c})` : reason;
}
