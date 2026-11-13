// src/lib/gmail-server.ts
// SERVER-ONLY. Never import from client components — uses secrets that
// must stay off the bundle (GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN).
//
// Env vars required (server-side, NOT VITE_-prefixed):
//   GMAIL_CLIENT_ID
//   GMAIL_CLIENT_SECRET
//   GMAIL_REFRESH_TOKEN
//   GMAIL_BUSINESS_EMAIL   e.g. "prince@rareglobalfood.com"

import { getEnv } from "@/lib/env";
import { getStoredReplyMedia, isReplyMediaId, MAX_REPLY_TOTAL_SIZE } from "@/lib/reply-media";
import { replyHtmlToText, sanitizeReplyHtml } from "@/lib/reply-format";
import { getReplyAllCcRecipients, parseEmailRecipients } from "@/lib/email-recipients";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/**
 * IMPORTANT: this must be a function, not a module-level constant, and it reads through getEnv() (the server
 * environment) at request time, like every other secret.
 */
export async function getGmailBusinessEmail(): Promise<string> {
  // Trimmed: a space or line break pasted along with a secret breaks the match.
  return ((await getEnv("GMAIL_BUSINESS_EMAIL")) || "").trim();
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 30_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ((await getEnv("GMAIL_CLIENT_ID")) || "").trim(),
      client_secret: ((await getEnv("GMAIL_CLIENT_SECRET")) || "").trim(),
      refresh_token: ((await getEnv("GMAIL_REFRESH_TOKEN")) || "").trim(),
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

export async function gmailFetch<T = any>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${GMAIL_API}/users/me${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function sendGmailReply({
  to,
  cc = [],
  bcc = [],
  subject,
  body,
  threadId,
  mode = "reply",
  htmlBody,
  attachmentIds = [],
}: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  threadId?: string;
  mode?: "reply" | "replyAll" | "forward";
  htmlBody?: string;
  attachmentIds?: string[];
}): Promise<{ id: string; threadId?: string }> {
  if (attachmentIds.some((id) => !isReplyMediaId(id))) {
    throw new Error("Invalid attachment reference");
  }
  if (attachmentIds.length > 10) throw new Error("You can attach up to 10 files at once.");

  const accessToken = await getAccessToken();
  const from = (await getGmailBusinessEmail()).trim();
  if (!from) throw new Error("GMAIL_BUSINESS_EMAIL is not configured");

  const toRecipients = parseEmailRecipients(to.join(", "));
  const ccRecipients = parseEmailRecipients(cc.join(", "));
  const bccRecipients = parseEmailRecipients(bcc.join(", "));
  if (!toRecipients.length) throw new Error("At least one To recipient is required.");

  const cleanHeader = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let replyHeaders: string[] = [];
  let forwardText = "";
  let forwardHtml = "";
  let resolvedCc = ccRecipients;
  if (threadId) {
    const thread = await gmailFetch<{
      messages?: {
        payload?: {
          headers?: { name: string; value: string }[];
          mimeType?: string;
          body?: { data?: string };
          parts?: unknown[];
        };
      }[];
    }>(`/threads/${encodeURIComponent(threadId)}?format=full`, accessToken);
    const messages = thread.messages ?? [];
    const latestMessage = messages[messages.length - 1];
    const latestHeaders = latestMessage?.payload?.headers;
    const messageId = getHeader(latestHeaders, "Message-ID");
    const references = getHeader(latestHeaders, "References");
    if (mode !== "forward" && messageId) {
      replyHeaders = [
        `In-Reply-To: ${messageId}`,
        `References: ${[references, messageId].filter(Boolean).join(" ")}`,
      ];
    }

    if (mode === "replyAll") {
      const businessAddress = from.toLowerCase();
      const replySource = [...messages].reverse().find((message) => {
        const senders = parseEmailRecipients(getHeader(message.payload?.headers, "From"));
        return (
          senders.length > 0 &&
          senders.every((address) => address.toLowerCase() !== businessAddress)
        );
      });
      const headers = replySource?.payload?.headers;
      const replyAllCc = getReplyAllCcRecipients({
        toRecipients,
        headerTo: getHeader(headers, "To"),
        headerCc: getHeader(headers, "Cc"),
        businessEmail: businessAddress,
      });
      resolvedCc = parseEmailRecipients([...ccRecipients, ...replyAllCc].join(", "));
    }

    if (mode === "forward" && latestMessage?.payload) {
      const headers = latestHeaders;
      const original = extractBody(latestMessage.payload);
      const originalHtml = [original.body, original.quotedBody].filter(Boolean).join("<br>");
      const originalText = replyHtmlToText(originalHtml);
      const forwardHeaders = [
        `From: ${getHeader(headers, "From")}`,
        `Date: ${getHeader(headers, "Date")}`,
        `Subject: ${getHeader(headers, "Subject")}`,
        `To: ${getHeader(headers, "To")}`,
        getHeader(headers, "Cc") ? `Cc: ${getHeader(headers, "Cc")}` : "",
      ].filter(Boolean);
      forwardText = `\n\n---------- Forwarded message ----------\n${forwardHeaders.join("\n")}\n\n${originalText}`;
      const escapedHeaders = forwardHeaders
        .map((header) => `<div>${escapeHtml(header)}</div>`)
        .join("");
      forwardHtml = `<br><hr><div><strong>Forwarded message</strong></div>${escapedHeaders}<br>${originalHtml}`;
    }
  }

  const encodeHeader = (value: string) => {
    const clean = cleanHeader(value);
    return /^[\x20-\x7e]*$/.test(clean)
      ? clean
      : `=?UTF-8?B?${Buffer.from(clean, "utf-8").toString("base64")}?=`;
  };
  const authoredText = body.trim() || replyHtmlToText(htmlBody || "");
  const textBody = authoredText + forwardText;
  const escapedText = authoredText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const safeHtml = sanitizeReplyHtml((htmlBody || `<div>${escapedText}</div>`) + forwardHtml);
  const mixedBoundary = `reply_mixed_${crypto.randomUUID().replace(/-/g, "")}`;
  const alternativeBoundary = `reply_alt_${crypto.randomUUID().replace(/-/g, "")}`;
  const attachments = [];
  let attachmentSize = 0;
  for (const id of attachmentIds) {
    const attachment = await getStoredReplyMedia(id);
    if (!attachment)
      throw new Error("An attachment has expired or is no longer available. Please add it again.");
    attachmentSize += attachment.size;
    attachments.push(attachment);
  }
  if (attachmentSize > MAX_REPLY_TOTAL_SIZE) {
    throw new Error(
      `The combined attachment size must be ${MAX_REPLY_TOTAL_SIZE / 1024 / 1024} MB or smaller.`,
    );
  }

  const message = [
    `From: ${cleanHeader(from)}`,
    `To: ${toRecipients.map(cleanHeader).join(", ")}`,
    ...(resolvedCc.length ? [`Cc: ${resolvedCc.map(cleanHeader).join(", ")}`] : []),
    ...(bccRecipients.length ? [`Bcc: ${bccRecipients.map(cleanHeader).join(", ")}`] : []),
    `Subject: ${encodeHeader(subject || "(no subject)")}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    ...replyHeaders,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    textBody,
    `--${alternativeBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    safeHtml,
    `--${alternativeBoundary}--`,
  ].join("\r\n");

  let mimeParts = message;
  for (const attachment of attachments) {
    const base64 = Buffer.from(await attachment.arrayBuffer())
      .toString("base64")
      .replace(/.{1,76}/g, "$&\r\n")
      .trim();
    const filename = encodeURIComponent(attachment.filename).replace(/'/g, "%27");
    mimeParts += [
      "",
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename*=UTF-8''${filename}`,
      "",
      base64,
    ].join("\r\n");
  }
  mimeParts += `\r\n--${mixedBoundary}--`;

  const encoded = Buffer.from(mimeParts, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const res = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw: encoded,
      ...(threadId && mode !== "forward" ? { threadId } : {}),
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Gmail send failed (${res.status}): ${bodyText}`);
  }

  const json = (await res.json()) as { id?: string; threadId?: string };
  const resolvedThreadId = mode === "forward" ? undefined : json.threadId || threadId;
  return {
    id: json.id || "",
    ...(resolvedThreadId ? { threadId: resolvedThreadId } : {}),
  };
}

export function getHeader(
  headers: { name: string; value: string }[] | undefined,
  name: string,
): string {
  if (!headers) return "";
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

/** "Name" <email@x> or a bare email -> { name, email } */
export function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (match) return { name: (match[1] || "").trim(), email: (match[2] || "").trim().toLowerCase() };
  return { name: raw.trim(), email: raw.trim().toLowerCase() };
}

export function extractBody(payload: any): { body: string; quotedBody: string | null } {
  const decode = (data: string) =>
    Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function walk(part: any): { html?: string; text?: string } {
    if (!part) return {};
    if (part.mimeType === "text/html" && part.body?.data) return { html: decode(part.body.data) };
    if (part.mimeType === "text/plain" && part.body?.data) return { text: decode(part.body.data) };
    if (part.parts) {
      let html: string | undefined;
      let text: string | undefined;
      for (const p of part.parts) {
        const r = walk(p);
        html = html || r.html;
        text = text || r.text;
      }
      const out: { html?: string; text?: string } = {};
      if (html !== undefined) out.html = html;
      if (text !== undefined) out.text = text;
      return out;
    }
    return {};
  }

  // Gmail (and most clients that interop with it) wrap the entire quoted
  // history of a reply in a container carrying one of these markers, right
  // after the new content. Splitting there and rendering the quoted part
  // collapsed-by-default (a real "Show quoted text" toggle) is exactly how
  // Gmail's own UI behaves -- previously the whole thing was rendered
  // unfolded every time, so every reply visually duplicated the entire prior
  // message underneath it.
  function splitQuote(html: string): { body: string; quotedBody: string | null } {
    const markers = [
      /<div[^>]*class="[^"]*gmail_quote[^"]*"/i,
      /<blockquote[^>]*class="[^"]*gmail_quote[^"]*"/i,
      /<div[^>]*class="[^"]*yahoo_quoted[^"]*"/i,
      /<div[^>]*id="[^"]*divRplyFwdMsg[^"]*"/i, // Outlook
      /<hr[^>]*id="[^"]*stopSpelling[^"]*"/i, // Outlook plain-text style
    ];
    let splitAt = -1;
    for (const re of markers) {
      const m = html.match(re);
      if (m && m.index !== undefined && (splitAt === -1 || m.index < splitAt)) splitAt = m.index;
    }
    if (splitAt === -1) return { body: html, quotedBody: null };
    return { body: html.slice(0, splitAt), quotedBody: html.slice(splitAt) };
  }

  const { html, text } = walk(payload);
  if (html) return splitQuote(html);
  if (text) {
    // Plain-text replies quote with a leading "On ... wrote:" line followed by
    // "> " prefixed lines. Split there the same way.
    const lines = text.split("\n");
    const quoteStart = lines.findIndex(
      (l) => /^On .+wrote:\s*$/.test(l.trim()) || /^>/.test(l.trim()),
    );
    if (quoteStart > 0) {
      const bodyText = lines.slice(0, quoteStart).join("\n").trim();
      const quotedText = lines.slice(quoteStart).join("\n").trim();
      return {
        body: `<pre>${escapeHtml(bodyText)}</pre>`,
        quotedBody: quotedText ? `<pre>${escapeHtml(quotedText)}</pre>` : null,
      };
    }
    return { body: `<pre>${escapeHtml(text)}</pre>`, quotedBody: null };
  }
  return { body: "<em>(no body)</em>", quotedBody: null };
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export function extractAttachments(payload: any): Attachment[] {
  const out: Attachment[] = [];
  function walk(part: any) {
    if (!part) return;
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body?.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) for (const p of part.parts) walk(p);
  }
  walk(payload);
  return out;
}
