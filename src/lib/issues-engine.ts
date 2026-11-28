// SERVER-ONLY. Saves the status of an escalation / system notification and its history through the engine chosen
// by the switch "wave1.escalations": n8n (workflows 27 and 33 as today), shadow (n8n + a dry run in the backend) or
// core (the backend). Used by the Escalations screen AND the AI assistant. DATA ONLY: nothing here sends a message
// or places a call.
import { requireSecret } from "@/lib/env";
import { coreFetch, switchMode } from "@/lib/core-client";

const N8N = "https://rareglobalfood.app.n8n.cloud/webhook";
const SWITCH = "wave1.escalations";

export type IssueStatus = "OPEN" | "IN_PROGRESS" | "DONE";
export interface IssueEventIn {
  issue_id: string;
  issue_kind: "ESCALATION" | "SYSTEM";
  ref: string;
  event: "DIAGNOSIS" | "ACTION" | "STATUS" | "RESOLUTION" | "NOTE";
  summary: string;
  detail?: unknown;
  actor: string;
}
interface StatusIn {
  entryId: string;
  status: IssueStatus;
  handledBy: string;
  note: string;
}
type Engine = "n8n" | "core";

const nameFor = (v: string) => (v.trim() || "dashboard").slice(0, 80);

/** The backend does it, or null when it cannot take it (down, or its switch is not on core): then n8n does. */
async function viaCore<T>(
  path: string,
  actor: string,
  body: unknown,
  pick: (out: Record<string, unknown>) => T,
): Promise<T | null> {
  let res: Response;
  try {
    res = await coreFetch(path, { method: "POST", actor: nameFor(actor), body });
  } catch (err) {
    console.warn(`[issues] backend unreachable (${path}), using n8n:`, String(err).slice(0, 120));
    return null;
  }
  if (res.status === 409 || res.status === 503) return null;
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || out["ok"] !== true)
    throw new Error(
      `backend ${path} failed (${res.status}): ${JSON.stringify(out["detail"] ?? out).slice(0, 200)}`,
    );
  return pick(out);
}

async function shadow(path: string, actor: string, body: Record<string, unknown>): Promise<void> {
  try {
    await coreFetch(path, {
      method: "POST",
      actor: nameFor(actor),
      body: { ...body, dry_run: true },
      timeoutMs: 15_000,
    });
  } catch (err) {
    console.warn(`[issues] shadow run failed (${path}):`, String(err).slice(0, 120));
  }
}

export async function saveIssueStatus(
  a: StatusIn,
): Promise<{ updated: number; handledBy: Engine }> {
  const mode = await switchMode(SWITCH);
  const coreBody = { entry_id: a.entryId, status: a.status, note: a.note.slice(0, 2000) };
  if (mode === "core") {
    const updated = await viaCore(
      "/v1/escalations/status",
      a.handledBy,
      coreBody,
      (o) => Number(o["updated"]) || 0,
    );
    if (updated !== null) return { updated, handledBy: "core" };
  }
  const res = await fetch(`${N8N}/worklist-update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worklist-secret": await requireSecret("N8N_WORKLIST_SECRET"),
    },
    body: JSON.stringify({
      entry_id: a.entryId,
      status: a.status,
      handled_by: a.handledBy.slice(0, 80),
      note: a.note.slice(0, 1000),
    }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; updated?: number };
  if (!res.ok || !out.ok) throw new Error(`Saving the status failed (${res.status})`);
  if (mode === "shadow") void shadow("/v1/escalations/status", a.handledBy, coreBody);
  return { updated: Number(out.updated) || 0, handledBy: "n8n" };
}

export async function saveIssueEvent(e: IssueEventIn): Promise<{ handledBy: Engine }> {
  const mode = await switchMode(SWITCH);
  const coreBody = { ...e, detail: e.detail ?? {} };
  if (mode === "core") {
    const done = await viaCore("/v1/issues/events", e.actor, coreBody, () => true);
    if (done) return { handledBy: "core" };
  }
  const res = await fetch(`${N8N}/issue-log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worklist-secret": await requireSecret("N8N_WORKLIST_SECRET"),
    },
    body: JSON.stringify({
      ...e,
      detail: typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail ?? {}),
    }),
  });
  if (!res.ok) throw new Error(`Recording the history failed (${res.status})`);
  if (mode === "shadow") void shadow("/v1/issues/events", e.actor, coreBody);
  return { handledBy: "n8n" };
}
