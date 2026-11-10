import { fetchAllDataTableRows, RECENT_60_DAYS } from "@/lib/n8n-datatable";

// Last contact per client (weekly run or /call): latest text sent, latest call placed and its result.
// Matched on the company part of client_id (before "___"), so a client whose contact changed keeps
// its earlier activity. Shared by the Clients list and Contact Approvals.
export type Act = Record<string, unknown>;
export interface ClientActivity {
  last_text_at: string;
  last_text_channel: string;
  last_text_source: string;
  last_call_at: string;
  last_call_source: string;
  last_call_result: string;
  contacted_via_call_command: boolean;
}

const MESSAGE_LOGS = "a32Z5oGcNi0xzefb";
const CONVERSATIONS = "2WtfkEaHiBSzgItW";
const RETRIES = "OgCEYfz7eGjS3dPz";
const str = (v: unknown) => (v == null ? "" : String(v));
export const companyKey = (id: unknown) => str(id).split("___")[0]!.trim().toLowerCase();

/** Start of the current reminder cycle: the most recent Wednesday 00:00 in Manila (UTC+8). */
export function cycleStart(now: Date = new Date()): Date {
  const manila = new Date(now.getTime() + 8 * 3600000);
  const back = (manila.getUTCDay() - 3 + 7) % 7; // 3 = Wednesday
  return new Date(
    Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate() - back) -
      8 * 3600000,
  );
}

export async function loadActivityTables(): Promise<[Act[], Act[], Act[]]> {
  return Promise.all([
    // Only recent activity is needed here (this cycle): read the last 60 days.
    fetchAllDataTableRows<Act>(MESSAGE_LOGS, RECENT_60_DAYS).catch(() => [] as Act[]),
    fetchAllDataTableRows<Act>(CONVERSATIONS, RECENT_60_DAYS).catch(() => [] as Act[]),
    fetchAllDataTableRows<Act>(RETRIES).catch(() => [] as Act[]),
  ]);
}

export function buildActivity(
  logs: Act[],
  convos: Act[],
  retries: Act[],
): (clientId: string) => ClientActivity {
  const at = (r: Act) => new Date(str(r["timestamp"]) || str(r["createdAt"])).getTime() || 0;
  const lastText = new Map<string, Act>();
  const lastCall = new Map<string, Act>();
  for (const l of logs) {
    const ev = str(l["event_type"]).toUpperCase();
    const ch = str(l["channel"]).toUpperCase();
    const k = companyKey(l["client_id"]);
    if (!k) continue;
    const target =
      ev === "SEND_SUCCESS" && ch !== "VOICE"
        ? lastText
        : ch === "VOICE" && ev === "CALL_INITIATED"
          ? lastCall
          : null;
    if (!target) continue;
    const prev = target.get(k);
    if (!prev || at(l) > at(prev)) target.set(k, l);
  }
  const answeredAfter = (k: string, t: number) =>
    convos.some(
      (c) =>
        companyKey(c["client_id"]) === k &&
        str(c["channel"]).toUpperCase() === "VOICE" &&
        at(c) >= t - 60000,
    );
  const retryOf = (k: string) =>
    retries.filter((r) => companyKey(r["client_id"]) === k).sort((a, b) => at(b) - at(a))[0];
  const sourceLabel = (r?: Act) => {
    const src = str(r?.["trigger_source"]).toUpperCase();
    const who = str(r?.["requested_by"]);
    if (src === "CLIQ_CALL") return "/call" + (who ? " · " + who : "");
    if (src === "RETRY") return "Retry";
    if (src === "MANUAL_RUN") return "Manual run";
    return "Weekly run";
  };
  // The email / Viber / SMS send logs do not record who started them; the call log of the same /call run
  // does. Take the source of a text from a call of the same company placed up to 15 minutes after it.
  const textSource = (k: string, tx: Act) => {
    if (str(tx["trigger_source"])) return sourceLabel(tx);
    const t = at(tx);
    const call = logs.find(
      (l) =>
        companyKey(l["client_id"]) === k &&
        str(l["channel"]).toUpperCase() === "VOICE" &&
        str(l["trigger_source"]) &&
        at(l) >= t &&
        at(l) - t <= 15 * 60000,
    );
    return call ? sourceLabel(call) : sourceLabel(tx);
  };
  return (clientId: string) => {
    const k = companyKey(clientId);
    const tx = lastText.get(k);
    const cl = lastCall.get(k);
    let callResult = "";
    if (cl) {
      const t = at(cl);
      const rt = retryOf(k);
      const rtAt = rt ? new Date(str(rt["updatedAt"])).getTime() || 0 : 0;
      if (answeredAfter(k, t)) callResult = "Answered";
      else if (rt && rtAt >= t - 60000 && str(rt["status"]).toUpperCase() === "PENDING")
        callResult = "Retry pending";
      else if (rt && rtAt >= t - 60000 && str(rt["status"]).toUpperCase() === "EXHAUSTED")
        callResult = "Not reached";
      else if (Date.now() - t < 15 * 60000) callResult = "In progress";
      else callResult = "No answer";
    }
    return {
      last_text_at: tx ? str(tx["timestamp"]) : "",
      last_text_channel: tx ? str(tx["channel"]).toUpperCase() : "",
      last_text_source: tx ? textSource(k, tx) : "",
      last_call_at: cl ? str(cl["timestamp"]) : "",
      last_call_source: cl ? sourceLabel(cl) : "",
      last_call_result: callResult,
      contacted_via_call_command: [tx, cl].some(
        (r) => str(r?.["trigger_source"]).toUpperCase() === "CLIQ_CALL",
      ),
    };
  };
}
