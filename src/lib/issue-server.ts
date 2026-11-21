// SERVER-ONLY. AI assistant: find an escalation or a system notification, load what it needs (client,
// conversations, promises, sends, the n8n execution), diagnose it, and read / write its history.
import { fetchAllDataTableRows } from "@/lib/n8n-datatable";
import { getEnv } from "@/lib/env";
import { logIssueEvent } from "@/lib/n8n-actions";
import {
  diagnoseEscalation,
  diagnoseSystem,
  issueKind,
  type EscalationDiagnosis,
  type IssueKind,
  type SystemDiagnosis,
} from "@/lib/issue-diagnosis";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const at = (r: Row) => new Date(s(r["timestamp"]) || s(r["createdAt"])).getTime() || 0;
const rows = (id: string) => fetchAllDataTableRows<Row>(id).catch(() => [] as Row[]);
export const ISSUE_TABLES = {
  escalations: "ANfkZZDIrDuC4RjK",
  clients: "rJpqXxmxhqJnlLrJ",
  conversations: "2WtfkEaHiBSzgItW",
  promises: "JyGFOqTqI3QXHJbb",
  logs: "a32Z5oGcNi0xzefb",
  health: "vu4Ar3YK7tj0VaKy",
  issueLog: "ZDKnz6I2mnaNmVze",
};
const N8N_BASE = "https://rareglobalfood.app.n8n.cloud";

/** By entry id, or by Ref (newest row with that Ref: system Refs can repeat within a second). */
export function findIssue(all: Row[], refOrId: string): Row | undefined {
  const q = refOrId.trim();
  if (!q) return undefined;
  const byId = all.find((r) => s(r["entry_id"]) === q);
  if (byId) return byId;
  return all
    .filter((r) => s(r["ref"]).toLowerCase() === q.toLowerCase())
    .sort((a, b) => at(b) - at(a))[0];
}

export interface IssueHistoryLine {
  event: string;
  summary: string;
  actor: string;
  at: string;
}
export async function issueHistory(issueId: string): Promise<IssueHistoryLine[]> {
  return (await rows(ISSUE_TABLES.issueLog))
    .filter((r) => s(r["issue_id"]) === issueId)
    .sort((a, b) => s(a["timestamp"]).localeCompare(s(b["timestamp"])))
    .map((r) => ({
      event: s(r["event"]),
      summary: s(r["summary"]),
      actor: s(r["actor"]),
      at: s(r["timestamp"]),
    }));
}

/** The failed execution from n8n's API, when the API key may read executions (otherwise a reason). */
export async function executionDetails(executionId: string): Promise<{
  available: boolean;
  note?: string;
  status?: string;
  stopped_at?: string;
  node?: string;
  error?: string;
}> {
  if (!/^\d+$/.test(executionId))
    return { available: false, note: "No execution id in the notification." };
  const key = await getEnv("N8N_API_KEY");
  if (!key) return { available: false, note: "N8N_API_KEY is not configured." };
  try {
    const res = await fetch(`${N8N_BASE}/api/v1/executions/${executionId}?includeData=true`, {
      headers: { "X-N8N-API-KEY": key },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403)
      return {
        available: false,
        note: "The dashboard's n8n API key may not read executions (add the execution:read scope).",
      };
    if (res.status === 404)
      return { available: false, note: "The execution was not found (it may have been pruned)." };
    if (!res.ok) return { available: false, note: `n8n answered ${res.status}.` };
    const j = (await res.json()) as {
      status?: string;
      stoppedAt?: string;
      data?: {
        resultData?: {
          lastNodeExecuted?: string;
          error?: { message?: string; description?: string; node?: { name?: string } };
        };
      };
    };
    const err = j.data?.resultData?.error;
    return {
      available: true,
      status: s(j.status),
      stopped_at: s(j.stoppedAt),
      node: s(err?.node?.name) || s(j.data?.resultData?.lastNodeExecuted),
      error: [s(err?.message), s(err?.description)].filter(Boolean).join(" · ").slice(0, 800),
    };
  } catch (e) {
    return { available: false, note: `Could not reach n8n (${String(e).slice(0, 120)}).` };
  }
}

export interface IssueDiagnosis {
  kind: IssueKind;
  issue_id: string;
  ref: string;
  status: string;
  recorded_at: string;
  client_id: string;
  client_name: string;
  diagnosis: SystemDiagnosis | EscalationDiagnosis;
  execution?: Awaited<ReturnType<typeof executionDetails>>;
  related_health_alerts?: {
    title: string;
    detail: string;
    suggested_fix: string;
    last_seen: string;
  }[];
  history: IssueHistoryLine[];
}

export async function diagnoseIssue(
  refOrId: string,
  now = Date.now(),
): Promise<IssueDiagnosis | null> {
  const all = await rows(ISSUE_TABLES.escalations);
  const row = findIssue(all, refOrId);
  if (!row) return null;
  const kind = issueKind(row);
  const issueId = s(row["entry_id"]) || s(row["id"]);
  const base = {
    kind,
    issue_id: issueId,
    ref: s(row["ref"]),
    status: (s(row["status"]) || "OPEN").toUpperCase(),
    recorded_at: s(row["timestamp"]),
    client_id: s(row["client_id"]),
    client_name: s(row["client_name"]),
  };
  if (kind === "SYSTEM") {
    const diagnosis = diagnoseSystem(row, all, now);
    const [execution, health, history] = await Promise.all([
      executionDetails(diagnosis.failure.execution_id),
      rows(ISSUE_TABLES.health),
      issueHistory(issueId),
    ]);
    const wf = diagnosis.failure.workflow.toLowerCase();
    const related = health
      .filter((h) => s(h["status"]).toLowerCase() === "open")
      .filter(
        (h) =>
          !wf ||
          `${s(h["title"])} ${s(h["detail"])} ${s(h["affected"])}`
            .toLowerCase()
            .includes(wf.slice(0, 12)),
      )
      .slice(0, 5)
      .map((h) => ({
        title: s(h["title"]),
        detail: s(h["detail"]).slice(0, 300),
        suggested_fix: s(h["suggested_fix"]),
        last_seen: s(h["last_seen"]),
      }));
    return { ...base, diagnosis, execution, related_health_alerts: related, history };
  }
  const [clients, conversations, promises, logs, history] = await Promise.all([
    rows(ISSUE_TABLES.clients),
    rows(ISSUE_TABLES.conversations),
    rows(ISSUE_TABLES.promises),
    rows(ISSUE_TABLES.logs),
    issueHistory(issueId),
  ]);
  const key = s(row["client_id"]).split("___")[0]!.trim().toLowerCase();
  const client =
    clients.find((c) => s(c["client_id"]) === s(row["client_id"])) ??
    clients.find(
      (c) =>
        s(c["client_id"]).split("___")[0]!.trim().toLowerCase() === key &&
        s(c["status"]).toUpperCase() !== "INACTIVE",
    );
  const diagnosis = diagnoseEscalation(row, { client, conversations, promises, logs, now });
  return { ...base, diagnosis, history };
}

/**
 * Record the AI's diagnosis in the issue's history, once: a repeat of the same diagnosis within 6 hours is
 * not recorded again (asking twice does not fill the history).
 */
export async function recordDiagnosis(
  d: IssueDiagnosis,
  actor: string,
  now = Date.now(),
): Promise<boolean> {
  const summary =
    d.diagnosis.kind === "SYSTEM"
      ? `${d.diagnosis.category}: ${d.diagnosis.root_cause}`
      : `${d.diagnosis.type}: ${d.diagnosis.next_steps[0] ?? ""}`;
  const recent = d.history.some(
    (h) =>
      h.event === "DIAGNOSIS" &&
      h.summary === summary.slice(0, 1000) &&
      now - Date.parse(h.at) < 6 * 3600000,
  );
  if (recent) return false;
  await logIssueEvent({
    issue_id: d.issue_id,
    issue_kind: d.kind,
    ref: d.ref,
    event: "DIAGNOSIS",
    summary,
    detail: d.diagnosis,
    actor: `AI assistant (asked by ${actor})`,
  });
  return true;
}
