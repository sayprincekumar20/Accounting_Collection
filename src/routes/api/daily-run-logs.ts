import { createFileRoute } from "@tanstack/react-router";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { isNotReachedAlert } from "@/lib/authorship";

// Daily Run Log rows (written by v3 at each weekly run) plus live RESULTS for each run's cycle
// (from the run date until the next run, max 7 days): what was actually sent, called, replied,
// promised and escalated. Newest first.
const DAILY_RUN_LOG_TABLE_ID = "BVGj7FvvvVsg1QxY";
const MESSAGE_LOGS_TABLE_ID = "a32Z5oGcNi0xzefb";
const CONVERSATIONS_TABLE_ID = "2WtfkEaHiBSzgItW";
const PROMISES_TABLE_ID = "JyGFOqTqI3QXHJbb";
const ESCALATIONS_TABLE_ID = "ANfkZZDIrDuC4RjK";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v || 0);
const parseList = (v: unknown) => {
  try {
    const p = JSON.parse(s(v) || "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};
// Run dates are Manila dates; the cycle starts at 00:00 Manila (UTC+8) of the run date.
const manilaStart = (d: string) => new Date(`${d}T00:00:00+08:00`).getTime();
const ts = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;
const up = (v: unknown) => s(v).toUpperCase();

export const Route = createFileRoute("/api/daily-run-logs")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const [rows, logs, convos, promises, escalations] = await Promise.all([
            fetchAllDataTableRows<Row>(DAILY_RUN_LOG_TABLE_ID),
            fetchAllDataTableRows<Row>(MESSAGE_LOGS_TABLE_ID).catch(() => []),
            fetchAllDataTableRows<Row>(CONVERSATIONS_TABLE_ID).catch(() => []),
            fetchAllDataTableRows<Row>(PROMISES_TABLE_ID).catch(() => []),
            fetchAllDataTableRows<Row>(ESCALATIONS_TABLE_ID).catch(() => []),
          ]);

          const runs = rows
            .map((r) => ({
              run_date: s(r["run_date"]),
              run_timestamp: s(r["run_timestamp"]),
              total_processed: n(r["total_processed"]),
              total_outstanding: n(r["total_outstanding"]),
              email_queued: n(r["email_queued"]),
              sms_queued: n(r["sms_queued"]),
              viber_queued: n(r["viber_queued"]),
              voice_queued: n(r["voice_queued"]),
              skipped_cooldown: n(r["skipped_cooldown"]),
              skipped_multibranch: n(r["skipped_multibranch"]),
              skipped_salesperson: n(r["skipped_salesperson"]),
              no_contact_count: n(r["no_contact_count"]),
              no_contact_amount: n(r["no_contact_amount"]),
              no_contact_details: parseList(r["no_contact_details"]),
              email_only_count: n(r["email_only_count"]),
              email_only_amount: n(r["email_only_amount"]),
              email_only_details: parseList(r["email_only_details"]),
              // "recorded" = the run wrote this field (older rows predate some columns)
              recorded: {
                no_contact: r["no_contact_count"] != null,
                email_only: r["email_only_count"] != null,
                sms: r["sms_queued"] != null,
                voice: r["voice_queued"] != null,
              },
            }))
            .filter((r) => r.run_date)
            .sort((a, b) => manilaStart(b.run_date) - manilaStart(a.run_date));

          // Results per cycle: from this run's date until the next (newer) run, at most 7 days.
          const withResults = runs.map((run, i) => {
            const from = manilaStart(run.run_date);
            const newer = runs[i - 1];
            const to = Math.min(
              newer ? manilaStart(newer.run_date) : Infinity,
              from + 7 * 86400000,
            );
            const inCycle = (r: Row) => {
              const t = ts(r);
              return t >= from && t < to;
            };
            const cycleLogs = logs.filter(inCycle);
            const sent = (ch: string) =>
              cycleLogs.filter(
                (l) => up(l["channel"]) === ch && up(l["event_type"]) === "SEND_SUCCESS",
              ).length;
            const cycleConvos = convos.filter(inCycle);
            const cycleAlerts = escalations.filter((e) => inCycle(e) && up(e["channel"]) !== "SYSTEM");
            // Real escalations need AR action; "Not reached by phone" alerts are counted separately.
            const cycleEsc = cycleAlerts.filter((e) => !isNotReachedAlert(e["reason"]));
            const notReached = cycleAlerts.filter((e) => isNotReachedAlert(e["reason"]));
            return {
              ...run,
              results: {
                emails_sent: sent("EMAIL"),
                sms_sent: sent("SMS"),
                whatsapp_sent: sent("WHATSAPP"),
                calls_placed: cycleLogs.filter(
                  (l) => up(l["channel"]) === "VOICE" && up(l["event_type"]) === "CALL_INITIATED",
                ).length,
                calls_failed: cycleLogs.filter(
                  (l) => up(l["channel"]) === "VOICE" && up(l["event_type"]) === "CALL_FAILED",
                ).length,
                retries: cycleLogs.filter((l) => up(l["trigger_source"]) === "RETRY").length,
                cliq_call_sends: cycleLogs.filter((l) => up(l["trigger_source"]) === "CLIQ_CALL")
                  .length,
                client_replies: cycleConvos.filter((c) => up(c["direction"]) === "INBOUND").length,
                clients_replied: new Set(
                  cycleConvos
                    .filter((c) => up(c["direction"]) === "INBOUND")
                    .map((c) => s(c["client_id"])),
                ).size,
                ai_replies: cycleConvos.filter(
                  (c) =>
                    up(c["direction"]) === "OUTBOUND" &&
                    up(c["channel"]) !== "VOICE" &&
                    !/^overdue balance reminder/i.test(s(c["message_text"])),
                ).length,
                promises: promises.filter(inCycle).length,
                escalations: cycleEsc.length,
                not_reached: notReached.length,
              },
            };
          });

          return new Response(JSON.stringify({ runs: withResults }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[daily-run-logs] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch daily run logs" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
