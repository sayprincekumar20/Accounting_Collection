// src/lib/telerivet-server.ts
// SERVER-ONLY. Uses TELERIVET_API_KEY — must never reach the client bundle.
//
// Env vars required (server-side, NOT VITE_-prefixed):
//   TELERIVET_API_KEY
//   TELERIVET_PROJECT_ID     e.g. "PJ0c188306515689f8" (full ID, not the short form)
//   TELERIVET_SMS_PHONE_ID   the Phone/Route ID for your SMS service — REQUIRED if
//                            SMS and Viber share the same Telerivet project, so we
//                            don't mix the two channels' messages together. Find it
//                            in Telerivet dashboard -> Phones -> the SMS route's ID.

import { getEnv } from "@/lib/env";

const TELERIVET_API = "https://api.telerivet.com/v1";

async function authHeader() {
  const key = (await getEnv("TELERIVET_API_KEY")) || "";
  // Telerivet uses HTTP Basic auth: API key as username, empty password.
  return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

export interface TelerivetMessage {
  id: string;
  direction: "incoming" | "outgoing";
  content: string;
  from_number: string;
  to_number: string;
  phone_id: string;
  time_created: number; // unix seconds
  status: string;
}

/**
 * Fetches recent messages for the project, optionally filtered to one
 * Phone/Route ID (so SMS and Viber don't get mixed if they share a project).
 * Paginates up to `maxPages` to bound the request — this is a "recent
 * activity" view, not a full historical export.
 */
export async function fetchRecentMessages(opts: {
  phoneId?: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<TelerivetMessage[]> {
  const projectId = (await getEnv("TELERIVET_PROJECT_ID")) || "";
  const pageSize = opts.pageSize ?? 200;
  // Reduced from 5: this is a "recent activity" view, not a full export, and each
  // extra page is another sequential Telerivet call inside a route that already
  // fires 3 other concurrent requests (promise-history, escalations, clients) --
  // more pages means more chances for one transient failure to 500 the whole
  // combined endpoint. 200 recent messages is already generous for this view.
  const maxPages = opts.maxPages ?? 1;

  const all: TelerivetMessage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    // NOTE: for Telerivet's messages.query endpoint specifically, "sort" only
    // accepts the literal value "default" (unlike contacts.query, where
    // "time_created" etc. are valid). "time_created" here was silently causing
    // every request to be rejected by Telerivet -- confirmed root cause of the
    // SMS tab's persistent failure. Messages already come back newest-first by
    // default, and sort_dir still controls that ordering correctly.
    const params = new URLSearchParams({
      page_size: String(pageSize),
      sort: "default",
      sort_dir: "desc",
    });
    if (opts.phoneId) params.set("phone_id", opts.phoneId);
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${TELERIVET_API}/projects/${projectId}/messages?${params.toString()}`, {
      headers: await authHeader(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telerivet messages fetch failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as { data: TelerivetMessage[]; next_cursor?: string | null };
    all.push(...(data.data || []));

    if (!data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return all;
}
