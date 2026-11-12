// AI assistant contact lists, server side: loads our clients in the shape the matching rules need, builds the
// review table and runs "Approve + contact" with the same rules re-checked on the server (the browser's
// selection is never trusted on its own).
import { loadApprovalItems } from "@/lib/approvals-data";
import { clearDataTableCache } from "@/lib/n8n-datatable";
import { approveClients, contactClients } from "@/lib/n8n-actions";
import { audit, type ActionContext } from "./registry";
import {
  assessClient,
  buildIndex,
  matchRows,
  n8nNorm,
  summarize,
  type ContactListResult,
  type FileRow,
  type MatchClient,
} from "./list-match";

const APPROVALS_TABLE = "3IvKKI4AwrBlDeOo";
export const MAX_FILE_ROWS = 300;
export const MAX_CONTACT = 100;

export async function loadMatchClients(): Promise<{ clients: MatchClient[]; cycleStart: string }> {
  const { items, cycle_start } = await loadApprovalItems();
  const clients = items.map((i): MatchClient => ({
    client_id: i.client_id,
    client_name: i.client_name,
    parent_name: i.parent_name,
    contact_person: i.contact_person,
    email: i.email,
    phone: i.phone,
    ar_owner: i.ar_owner,
    sales_person: i.sales_person,
    collection_schedule: i.collection_schedule,
    overdue: i.overdue,
    current: i.current,
    total: i.total,
    branch_count: i.branch_count,
    multibranch: i.multibranch,
    approved: i.approved,
    allow_multibranch: i.allow_multibranch,
    text_this_cycle: i.text_this_cycle,
    call_this_cycle: i.call_this_cycle,
    promise_until: i.promise_until,
    ar_handoff_until: i.ar_handoff_until,
    sales_team: i.sales_team,
    internal_account: i.internal_account,
    invoices: i.invoices.map((v) => ({
      branch: v.branch,
      number: v.number,
      due: v.due,
      balance: v.balance,
      status: v.status,
      counter: v.counter,
    })),
  }));
  return { clients, cycleStart: cycle_start };
}

/** Clean rows from the browser: only what matching needs, bounded in size. */
export function sanitizeRows(input: unknown): FileRow[] {
  if (!Array.isArray(input)) return [];
  const out: FileRow[] = [];
  for (const r of input.slice(0, MAX_FILE_ROWS)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const name = String(o["name"] ?? "")
      .trim()
      .slice(0, 200);
    if (!name) continue;
    const amount =
      typeof o["amount"] === "number" && Number.isFinite(o["amount"]) ? o["amount"] : null;
    out.push({
      row: Number(o["row"]) || out.length + 1,
      name,
      owner: String(o["owner"] ?? "").slice(0, 80),
      amount,
      remarks: String(o["remarks"] ?? "").slice(0, 300),
    });
  }
  return out;
}

export async function buildReview(rows: FileRow[]) {
  const { clients, cycleStart } = await loadMatchClients();
  const review = matchRows(rows, clients);
  return { rows: review, summary: summarize(review), cycle_start: cycleStart };
}

/**
 * Approve (when needed) and contact the selected clients. Every client is re-assessed with the same rules as the
 * review table; anything blocked is rejected and reported, never sent.
 */
export async function runContactList(input: {
  clientIds: string[];
  requestedBy: string;
  sessionId: string;
  file: string;
}): Promise<ContactListResult> {
  const ids = [...new Set(input.clientIds.map(String))].slice(0, MAX_CONTACT);
  const { clients } = await loadMatchClients();
  const byId = new Map(clients.map((c) => [c.client_id, c]));
  const sameName = buildIndex(clients).sameName;

  const accepted: MatchClient[] = [];
  const rejected: ContactListResult["rejected"] = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) {
      rejected.push({
        client_id: id,
        name: id.split("___")[0] ?? id,
        reason: "no longer in the client list (no open balance, or retired)",
      });
      continue;
    }
    const a = assessClient(c, {
      match: "exact",
      sameNameCount: sameName.get(n8nNorm(c.client_name)) ?? 1,
      groupSize: 1,
      fileAmount: null,
    });
    if (!a.selectable)
      rejected.push({
        client_id: id,
        name: c.client_name,
        reason: a.flags
          .filter((f) => f.level === "block")
          .map((f) => f.label)
          .join("; "),
      });
    else accepted.push(c);
  }

  const ctx: ActionContext = {
    userName: input.requestedBy,
    sessionId: input.sessionId,
    page: "/assistant/contact-list",
    workingSet: [],
  };
  if (!accepted.length) {
    await audit(
      ctx,
      "contact_list",
      "write",
      { file: input.file, requested: ids.length },
      "REJECTED",
      "nothing could be contacted",
    );
    return {
      ok: false,
      accepted: [],
      approved: 0,
      rejected,
      reply: "",
      error: "None of the selected clients can be contacted.",
    };
  }

  // 1. Approvals (valid for this cycle only). 5+ branch accounts are approved WITH the multi-branch permission.
  const needApproval = accepted.filter(
    (c) => !c.approved || (c.multibranch && !c.allow_multibranch),
  );
  if (needApproval.length) {
    await approveClients(
      input.requestedBy,
      needApproval.map((c) => ({
        client_id: c.client_id,
        client_name: c.client_name,
        approved: true,
        note: `via AI assistant list${input.file ? ": " + input.file : ""}`.slice(0, 300),
        allow_multibranch: c.multibranch,
      })),
    );
    clearDataTableCache(APPROVALS_TABLE);
  }

  // 2. Contact: the whole selection in ONE request; n8n runs it in batches of 20 and files one AR report.
  const names = [...new Set(accepted.map((c) => c.client_name))];
  let reply = "";
  try {
    reply = (await contactClients(input.requestedBy, names, false, MAX_CONTACT)).reply;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(
      ctx,
      "contact_list",
      "write",
      { file: input.file, clients: names.length, approved: needApproval.length },
      "ERROR",
      msg,
    );
    return {
      ok: false,
      accepted: accepted.map((c) => ({ client_id: c.client_id, client_name: c.client_name })),
      approved: needApproval.length,
      rejected,
      reply: "",
      error: `${needApproval.length ? "The approvals were saved, but s" : "S"}tarting the contact failed: ${msg}`,
    };
  }
  await audit(
    ctx,
    "contact_list",
    "write",
    {
      file: input.file,
      clients: names.length,
      approved: needApproval.length,
      rejected: rejected.length,
    },
    "OK",
    `contact_list: ${names.length} contacted, ${needApproval.length} approved, ${rejected.length} rejected`,
  );
  return {
    ok: true,
    accepted: accepted.map((c) => ({ client_id: c.client_id, client_name: c.client_name })),
    approved: needApproval.length,
    rejected,
    reply,
  };
}
