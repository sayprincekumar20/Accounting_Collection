// SERVER-ONLY. Saves Contact Approvals through the engine chosen by the switch "wave1.approvals":
// n8n (today's workflow 28), shadow (n8n + a dry run in the backend) or core (the backend). Used by the
// Contact Approvals screen AND the AI assistant, so both always follow the same switch.
import { requireSecret } from "@/lib/env";
import { coreFetch, switchMode } from "@/lib/core-client";

const APPROVAL_WEBHOOK = "https://rareglobalfood.app.n8n.cloud/webhook/contact-approval-update";
const SWITCH = "wave1.approvals";
export type ApprovalItems = Record<string, unknown>[];

/** Today's path: n8n 28_Contact_Approval_Update. */
async function viaN8n(items: ApprovalItems, who: string): Promise<{ saved: number }> {
  const res = await fetch(APPROVAL_WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-approval-secret": await requireSecret("N8N_APPROVAL_SECRET"),
    },
    body: JSON.stringify({ approved_by: who, items }),
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; saved?: number };
  if (!res.ok || !out.ok) throw new Error(`n8n approval update failed (${res.status})`);
  return { saved: out.saved ?? items.length };
}

/** The backend does it. Returns null when the backend cannot take it (down, or its switch is not on core): the
 *  caller then uses n8n. An answer that means "partly done" (502) is an error, never a silent second attempt. */
async function viaCore(
  items: ApprovalItems,
  who: string,
): Promise<{ saved: number; warnings: string[] } | null> {
  let res: Response;
  try {
    res = await coreFetch("/v1/approvals", { method: "POST", actor: who, body: { items } });
  } catch (err) {
    console.warn("[contact-approvals] backend unreachable, using n8n:", String(err).slice(0, 120));
    return null;
  }
  if (res.status === 409 || res.status === 503) return null;
  const out = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    saved?: number;
    warnings?: string[];
    detail?: unknown;
  };
  if (!res.ok || !out.ok)
    throw new Error(
      `backend approval failed (${res.status}): ${JSON.stringify(out.detail ?? out).slice(0, 200)}`,
    );
  return { saved: out.saved ?? items.length, warnings: out.warnings ?? [] };
}

/** Shadow mode: the backend works out what it would do and records it; nothing is changed, errors never matter. */
async function shadowCore(items: ApprovalItems, who: string): Promise<void> {
  try {
    await coreFetch("/v1/approvals", {
      method: "POST",
      actor: who,
      body: { items, dry_run: true },
      timeoutMs: 15_000,
    });
  } catch (err) {
    console.warn("[contact-approvals] shadow run failed:", String(err).slice(0, 120));
  }
}

export async function saveApprovals(
  items: ApprovalItems,
  who: string,
): Promise<{ saved: number; handledBy: "n8n" | "core"; warnings: string[] }> {
  const mode = await switchMode(SWITCH);
  if (mode === "core") {
    const done = await viaCore(items, who);
    if (done) return { saved: done.saved, handledBy: "core", warnings: done.warnings };
  }
  const { saved } = await viaN8n(items, who);
  if (mode === "shadow") void shadowCore(items, who);
  return { saved, handledBy: "n8n", warnings: [] };
}
