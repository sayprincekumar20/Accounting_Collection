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

const TELERIVET_API = "https://api.telerivet.com/v1";

function authHeader() {
  const key = process.env["TELERIVET_API_KEY"] || "";
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
  const projectId = process.env["TELERIVET_PROJECT_ID"] || "";
  const pageSize = opts.pageSize ?? 200;
  const maxPages = opts.maxPages ?? 5;

  const all: TelerivetMessage[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      page_size: String(pageSize),
      sort: "time_created",
      sort_dir: "desc",
    });
    if (opts.phoneId) params.set("phone_id", opts.phoneId);
    if (cursor) params.set("cursor", cursor);

    const res = await fetch(`${TELERIVET_API}/projects/${projectId}/messages?${params.toString()}`, {
      headers: authHeader(),
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
