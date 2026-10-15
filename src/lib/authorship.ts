// SERVER-ONLY. Labels each message in a conversation with who wrote it, and returns the
// "notified AR team" escalations to show inline in that conversation.
//
//  - reminder : the automated overdue reminder (matched on the message log / reminder wording)
//  - ai       : the AI reply agent (it logs every reply it sends in the conversations table)
//  - ar_team  : anything else we sent from the same inbox / number, i.e. a person in AR
//  - client   : the client
//  - system   : delivery failures (mailer-daemon, postmaster, no-reply)
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";

const CONVERSATIONS_TABLE_ID = "2WtfkEaHiBSzgItW";
const ESCALATIONS_TABLE_ID = "ANfkZZDIrDuC4RjK";
const MESSAGE_LOGS_TABLE_ID = "a32Z5oGcNi0xzefb";

type Row = Record<string, unknown>;
export type Author = "client" | "reminder" | "ai" | "ar_team" | "system";
export interface EscalationNote {
  reason: string;
  recorded_at: string;
  channel: string;
}
export interface AuthorshipContext {
  convos: Row[];
  escalations: Row[];
  logs: Row[];
}

const s = (v: unknown) => (v == null ? "" : String(v));
const up = (v: unknown) => s(v).toUpperCase();
const ts = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

// Wording of every reminder template (email, SMS, WhatsApp/Viber, old and new). Reminders are also
// matched exactly by their message id in the send log (EMAIL / SMS SEND_SUCCESS).
const REMINDER_TEXT =
  /(^overdue balance reminder)|(friendly reminder that the following invoice)|(you have \d+ (overdue|current) invoices?)|(overdue (account|accounts) with rare global food)|(would like to follow up if we have available collection)|(your account statement from rare global food)|(please see the attached statement for details)/i;

/** The automatic "Not reached by phone today (...)" alert: not an escalation needing AR action. */
export const isNotReachedAlert = (reason: unknown) => /^not reached by phone/i.test(String(reason || "").trim());

export async function loadAuthorshipContext(): Promise<AuthorshipContext> {
  const [convos, escalations, logs] = await Promise.all([
    fetchAllDataTableRows<Row>(CONVERSATIONS_TABLE_ID).catch(() => []),
    fetchAllDataTableRows<Row>(ESCALATIONS_TABLE_ID).catch(() => []),
    fetchAllDataTableRows<Row>(MESSAGE_LOGS_TABLE_ID).catch(() => []),
  ]);
  return { convos, escalations, logs };
}

/** Client ids that the conversations log links to an email thread. */
export function clientIdsForThread(ctx: AuthorshipContext, threadId: string): string[] {
  return [
    ...new Set(
      ctx.convos.filter((r) => s(r["thread_id"]) === threadId).map((r) => s(r["client_id"])),
    ),
  ].filter(Boolean);
}

/** Who wrote a message WE sent (outbound): the automated reminder, the AI agent, or a person in AR. */
export function classifyOutbound(
  ctx: AuthorshipContext,
  opts: {
    clientIds: string[];
    channel: string;
    at: number;
    text?: string | undefined;
    messageId?: string | undefined;
    threadId?: string | undefined;
  },
): Author {
  const channel = opts.channel.toUpperCase();
  const text = norm(opts.text || "");
  if (
    opts.messageId &&
    ctx.logs.some(
      (l) =>
        s(l["message_id"]) === opts.messageId &&
        up(l["event_type"]) === "SEND_SUCCESS" &&
        up(l["channel"]) === channel,
    )
  ) {
    return "reminder";
  }
  if (REMINDER_TEXT.test(text)) return "reminder";
  const ids = new Set(opts.clientIds);
  const aiRows = ctx.convos.filter(
    (r) =>
      up(r["direction"]) === "OUTBOUND" &&
      up(r["channel"]) === channel &&
      (ids.has(s(r["client_id"])) || (opts.threadId && s(r["thread_id"]) === opts.threadId)) &&
      !REMINDER_TEXT.test(norm(s(r["message_text"]))),
  );
  const head = text.slice(0, 40);
  const isAi = aiRows.some((r) => {
    const close = opts.at && Math.abs(ts(r) - opts.at) <= 10 * 60 * 1000;
    const sameText = head.length >= 12 && norm(s(r["message_text"])).startsWith(head);
    return close || sameText;
  });
  return isAi ? "ai" : "ar_team";
}

/** "Notified AR team" escalations for these clients (optionally one channel), oldest first. */
export function escalationsFor(
  ctx: AuthorshipContext,
  clientIds: string[],
  channel?: string,
): EscalationNote[] {
  const ids = new Set(clientIds);
  return ctx.escalations
    .filter((e) => ids.has(s(e["client_id"])) && up(e["channel"]) !== "SYSTEM" && !isNotReachedAlert(e["reason"]))
    .filter((e) => !channel || up(e["channel"]) === channel.toUpperCase())
    .map((e) => ({
      reason: s(e["reason"]),
      recorded_at: s(e["timestamp"]) || s(e["createdAt"]),
      channel: up(e["channel"]),
    }))
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
}
