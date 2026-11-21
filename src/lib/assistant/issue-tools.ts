// AI assistant: support tool for customer escalations AND system notifications. The two kinds are always
// returned apart (never one mixed list); the assistant can analyse both, recommend, run permitted recovery
// actions after the user confirms, and record diagnosis, actions and resolution in the issue's history.
import { z } from "zod";
import { registerAction } from "./registry";
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { isNotReachedReason, isSystemRow } from "@/lib/escalation-alerts";
import { escalationType } from "@/lib/escalation-type";
import { parseSystemFailure, diagnoseSystem } from "@/lib/issue-diagnosis";
import { ISSUE_TABLES, diagnoseIssue, findIssue, recordDiagnosis } from "@/lib/issue-server";
import { callNow, logIssueEvent, runRecoveryAction, updateIssueStatus } from "@/lib/n8n-actions";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const at = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;
const rows = (id: string) => fetchAllDataTableRows<Row>(id).catch(() => [] as Row[]);
const statusOf = (r: Row) => (s(r["status"]) || "OPEN").toUpperCase();
const isFailure = (r: Row) =>
  /SYSTEM_ERROR/i.test(s(r["channel"])) || /^workflow failed/i.test(s(r["reason"]).trim());

registerAction({
  id: "list_issues",
  description:
    "Open issues for the AR team, ALWAYS as two separate lists: customer_escalations (disputes, payment claims, callbacks, document requests, wrong contacts: cases a client raised) and system_notifications (workflow failures, automation and integration errors). Use for 'what needs attention', 'any problems', 'open escalations', 'failed workflows'.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({
    kind: z.enum(["customer", "system", "both"]).optional(),
    status: z
      .enum(["OPEN", "IN_PROGRESS", "DONE", "NOT_DONE"])
      .optional()
      .describe("default NOT_DONE"),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async (a) => {
    const all = (await rows(ISSUE_TABLES.escalations)).sort((x, y) => at(y) - at(x));
    const want = a.status ?? "NOT_DONE";
    const keep = (r: Row) => (want === "NOT_DONE" ? statusOf(r) !== "DONE" : statusOf(r) === want);
    const limit = a.limit ?? 30;
    const customer =
      a.kind === "system"
        ? undefined
        : all
            .filter((r) => !isSystemRow(r) && !isNotReachedReason(r["reason"]) && keep(r))
            .slice(0, limit)
            .map((r) => ({
              ref: s(r["ref"]),
              id: s(r["entry_id"]),
              client: s(r["client_name"]) || s(r["client_id"]).split("___")[0],
              type: escalationType(r["reason"]),
              status: statusOf(r),
              channel: s(r["channel"]),
              reason: s(r["reason"]).slice(0, 200),
              at: s(r["timestamp"]),
            }));
    const system =
      a.kind === "customer"
        ? undefined
        : all
            .filter((r) => isSystemRow(r) && isFailure(r) && keep(r))
            .slice(0, limit)
            .map((r) => {
              const f = parseSystemFailure(r);
              return {
                ref: s(r["ref"]),
                id: s(r["entry_id"]),
                workflow: f.workflow,
                failed_node: f.node,
                category: diagnoseSystem(r, all).category,
                status: statusOf(r),
                error: f.error.slice(0, 200),
                at: s(r["timestamp"]),
              };
            });
    return {
      data: { customer_escalations: customer, system_notifications: system },
      summary: `list_issues: ${customer?.length ?? "-"} customer, ${system?.length ?? "-"} system`,
    };
  },
});

registerAction({
  id: "diagnose_issue",
  description:
    "Diagnose ONE escalation or system notification by its Ref (e.g. ESC-..., SYSTEM-20261118-070033) or id. Customer escalation: the reason, facts (balance, promise, hand-off, failed sends), the client's last messages, and the recommended next steps. System notification: workflow, failed node, error, the n8n execution, likely root cause, fixes, recurrence in 7 days, related health alerts. Includes the issue's history and the recovery actions that fit. The diagnosis is recorded in the issue's history. Always say which kind it is.",
  kind: "read",
  permission: "viewer",
  needsConfirmation: false,
  params: z.object({ issue: z.string().min(3).max(200).describe("Ref or entry id") }),
  execute: async (a, ctx) => {
    const d = await diagnoseIssue(a.issue);
    if (!d)
      return {
        data: { ok: false, message: `No escalation or system notification matches "${a.issue}".` },
        summary: "diagnose_issue: not found",
      };
    const recorded = await recordDiagnosis(d, ctx.userName).catch(() => false);
    return {
      data: {
        ok: true,
        ...d,
        recorded_in_history: recorded,
        recovery_note:
          "Recovery actions only run after the user confirms: run_recovery (regenerate_statement_pdf, refresh_client_from_zoho, call_again), prepare_reminder (send a reminder), update_issue (status, note, resolution).",
      },
      summary: `diagnose_issue: ${d.kind} ${d.ref || d.issue_id}`,
    };
  },
});

registerAction({
  id: "update_issue",
  description:
    "Set the status of an escalation or system notification (OPEN, IN_PROGRESS, DONE) with a note, and record it in its history. When status is DONE, give the final resolution (what fixed it).",
  kind: "write",
  permission: "ar",
  needsConfirmation: true,
  params: z.object({
    issue: z.string().min(3).max(200).describe("Ref or entry id"),
    status: z.enum(["OPEN", "IN_PROGRESS", "DONE"]),
    note: z.string().max(600).optional(),
    resolution: z
      .string()
      .max(600)
      .optional()
      .describe("required when status is DONE: what resolved it"),
  }),
  execute: async (a, ctx) => {
    const row = findIssue(await rows(ISSUE_TABLES.escalations), a.issue);
    if (!row)
      return {
        data: { ok: false, message: `No issue matches "${a.issue}".` },
        summary: "update_issue: not found",
      };
    if (a.status === "DONE" && !a.resolution?.trim())
      return {
        data: {
          ok: false,
          message: "Give the final resolution (what fixed it) to close the issue.",
        },
        summary: "update_issue: resolution missing",
      };
    const id = s(row["entry_id"]);
    const kind = isSystemRow(row) ? "SYSTEM" : "ESCALATION";
    const note = [a.resolution ? `Resolution: ${a.resolution}` : "", a.note ?? ""]
      .filter(Boolean)
      .join(" · ");
    const updated = await updateIssueStatus(id, a.status, ctx.userName, note);
    await logIssueEvent({
      issue_id: id,
      issue_kind: kind,
      ref: s(row["ref"]),
      event: a.status === "DONE" ? "RESOLUTION" : "STATUS",
      summary:
        a.status === "DONE"
          ? `Done: ${a.resolution}`
          : `Status ${a.status}${a.note ? `: ${a.note}` : ""}`,
      detail: { status: a.status, note: a.note ?? "", resolution: a.resolution ?? "" },
      actor: ctx.userName,
    }).catch(() => undefined);
    return {
      data: { ok: updated > 0, kind, status: a.status },
      ui: { op: "refresh" },
      summary: `update_issue: ${s(row["ref"]) || id} ${a.status}`,
    };
  },
});

registerAction({
  id: "run_recovery",
  description:
    "Run ONE permitted recovery action after the user confirms, and record it in the issue's history: regenerate_statement_pdf (a client's statement PDF, e.g. after a Drive quota failure), refresh_client_from_zoho (re-read one client's balance and contact from Zoho, e.g. after a paid claim or a contact correction), call_again (one call by Grace). Nothing else can be run.",
  kind: "write",
  permission: "ar",
  needsConfirmation: true,
  params: z.object({
    action: z.enum(["regenerate_statement_pdf", "refresh_client_from_zoho", "call_again"]),
    client: z
      .string()
      .max(200)
      .optional()
      .describe("client name or id; taken from the escalation when omitted"),
    issue: z
      .string()
      .max(200)
      .optional()
      .describe("Ref or id of the escalation / system notification this fixes"),
  }),
  execute: async (a, ctx) => {
    const issues = await rows(ISSUE_TABLES.escalations);
    const row = a.issue ? findIssue(issues, a.issue) : undefined;
    const clients = await rows(ISSUE_TABLES.clients);
    const want = (a.client || (row && !isSystemRow(row) ? s(row["client_id"]) : "")).trim();
    const q = want.toLowerCase();
    const active = clients.filter((c) => s(c["status"]).toUpperCase() !== "INACTIVE");
    const client =
      active.find((c) => s(c["client_id"]) === want) ??
      active.find((c) => s(c["client_name"]).toLowerCase() === q) ??
      (q.length >= 4 ? active.filter((c) => s(c["client_name"]).toLowerCase().includes(q)) : []).at(
        0,
      );
    if (!client)
      return {
        data: {
          ok: false,
          message: want
            ? `No active client matches "${want}".`
            : "Which client? Give the client's name.",
        },
        summary: "run_recovery: no client",
      };
    const clientId = s(client["client_id"]);
    const r =
      a.action === "call_again"
        ? await callNow(ctx.userName, clientId).then((x) => ({
            ok: x.ok,
            message: x.reply || (x.ok ? "Call started" : "Call not started"),
          }))
        : await runRecoveryAction(a.action, clientId, ctx.userName);
    if (row)
      await logIssueEvent({
        issue_id: s(row["entry_id"]),
        issue_kind: isSystemRow(row) ? "SYSTEM" : "ESCALATION",
        ref: s(row["ref"]),
        event: "ACTION",
        summary: `${a.action} for ${s(client["client_name"])}: ${r.ok ? "done" : "failed"}, ${r.message}`,
        detail: { action: a.action, client_id: clientId, ok: r.ok, message: r.message },
        actor: ctx.userName,
      }).catch(() => undefined);
    return {
      data: {
        ok: r.ok,
        action: a.action,
        client: s(client["client_name"]),
        message: r.message,
        recorded: !!row,
      },
      ui: { op: "refresh" },
      summary: `run_recovery: ${a.action} ${s(client["client_name"])} ${r.ok ? "ok" : "failed"}`,
    };
  },
});

export const ISSUE_TOOLS_READY = true;
