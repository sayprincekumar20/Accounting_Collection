// src/lib/gmail-server.ts
// SERVER-ONLY. Never import from client components — uses secrets that
// must stay off the bundle (GMAIL_CLIENT_ID / SECRET / REFRESH_TOKEN).
//
// Env vars required (server-side, NOT VITE_-prefixed):
//   GMAIL_CLIENT_ID
//   GMAIL_CLIENT_SECRET
//   GMAIL_REFRESH_TOKEN
//   GMAIL_BUSINESS_EMAIL   e.g. "yourteam@yourcompany.com"

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export const GMAIL_BUSINESS_EMAIL = process.env["GMAIL_BUSINESS_EMAIL"] || "";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Returns a valid Gmail OAuth access token, refreshing it if the cached
 * one is within 30s of expiring. Avoids hitting Google's token endpoint
 * on every single request.
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 30_000) {
    return cachedToken.accessToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env["GMAIL_CLIENT_ID"] || "",
      client_secret: process.env["GMAIL_CLIENT_SECRET"] || "",
      refresh_token: process.env["GMAIL_REFRESH_TOKEN"] || "",
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail token refresh failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

/**
 * Thin wrapper around the Gmail REST API. `path` is relative to
 * /gmail/v1/users/me, e.g. "/threads?maxResults=40".
 */
export async function gmailFetch<T = any>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${GMAIL_API}/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${path} failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<T>;
}

export function getHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

/** "Name" <email@x> or a bare email -> { name, email } */
export function parseSender(raw: string): { name: string; email: string } {
  const match = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (match) return { name: (match[1] || "").trim(), email: (match[2] || "").trim() };
  return { name: raw.trim(), email: raw.trim() };
}

/**
 * Walks a Gmail message's MIME payload and returns the best HTML body it
 * can find. Falls back to escaped plain text wrapped in <pre> if no HTML
 * part exists.
 */
export function extractHtmlBody(payload: any): string {
  const decode = (data: string) =>
    Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function walk(part: any): { html?: string; text?: string } {
    if (!part) return {};
    if (part.mimeType === "text/html" && part.body?.data) {
      return { html: decode(part.body.data) };
    }
    if (part.mimeType === "text/plain" && part.body?.data) {
      return { text: decode(part.body.data) };
    }
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

  const { html, text } = walk(payload);
  if (html) return html;
  if (text) return `<pre>${escapeHtml(text)}</pre>`;
  return "<em>(no body)</em>";
}
