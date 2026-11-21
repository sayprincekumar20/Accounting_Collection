process.env.N8N_CONTACT_SECRET = "test-contact";
process.env.N8N_WORKLIST_SECRET = "test-worklist";
process.env.N8N_API_KEY = "test-api-key";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tables: Record<string, Record<string, unknown>[]> = {};
vi.mock("../src/lib/n8n-datatable", () => ({
  RECENT_60_DAYS: { sinceDays: 60, dateColumn: "timestamp" },
  fetchAllDataTableRows: async (id: string) => tables[id] ?? [],
  fetchDataTable: async (id: string) => ({ rows: tables[id] ?? [], truncated: false }),
  insertDataTableRows: async () => undefined,
  clearDataTableCache: () => {},
  truncationHeaders: () => ({}),
}));
const { runAction } = await import("../src/lib/assistant/registry");
await import("../src/lib/assistant/tools");

const ESC = "ANfkZZDIrDuC4RjK",
  CLIENTS = "rJpqXxmxhqJnlLrJ",
  LOG = "ZDKnz6I2mnaNmVze";
const ctx = { userName: "Tester", sessionId: "s1", page: "/", workingSet: [] as string[] };
const calls: { url: string; body: Record<string, unknown> }[] = [];
const hook = (name: string) => calls.filter((c) => c.url.includes(`/webhook/${name}`));

const system = {
  entry_id: "SYSTEM___workflow-error-1",
  client_id: "SYSTEM___workflow-error",
  client_name: "00_Zoho_Data_Fetch_Master_v3",
  channel: "SYSTEM_ERROR",
  ref: "SYSTEM-20261118-070033",
  reason:
    "Workflow failed: 00_Zoho_Data_Fetch_Master_v3 - Forbidden - perhaps check your credentials? (Quota exceeded for quota metric 'Queries' of service 'drive.googleapis.com')",
  message:
    "🚨 WORKFLOW FAILED\n\nWorkflow: 00_Zoho_Data_Fetch_Master_v3\nFailed at: Search Date Folder\nError: Forbidden\nExecution: https://rareglobalfood.app.n8n.cloud/workflow/AdAx7gEP9m53xstX/executions/160724",
  timestamp: new Date(Date.now() - 3600000).toISOString(),
};
const closeout = {
  entry_id: "SYSTEM___cycle-1",
  client_id: "SYSTEM___cycle-close-out",
  channel: "SYSTEM",
  reason: "Weekly cycle closed",
  timestamp: new Date().toISOString(),
};
const customer = {
  entry_id: "ACME-ESC-1",
  client_id: "ACME___a@b.co",
  client_name: "ACME",
  channel: "EMAIL",
  ref: "ESC-ACME-1",
  reason: "Client says already paid last Friday",
  timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
};
const notReached = {
  entry_id: "NR-1",
  client_id: "ACME___a@b.co",
  channel: "VOICE",
  reason: "Not reached by phone (busy), including the automatic retry.",
  timestamp: new Date().toISOString(),
};

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  calls.length = 0;
  tables[ESC] = [system, closeout, customer, notReached];
  tables[CLIENTS] = [
    {
      client_id: "ACME___a@b.co",
      client_name: "ACME",
      status: "ACTIVE",
      collection_amount: 12000,
      overdue_total: 9000,
    },
  ];
  tables[LOG] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (String(url).includes("/api/v1/executions/"))
        return new Response("forbidden", { status: 403 });
      if (String(url).includes("/webhook/worklist-update"))
        return new Response(JSON.stringify({ ok: true, updated: 1 }), { status: 200 });
      if (String(url).includes("/webhook/recovery-action"))
        return new Response(JSON.stringify({ ok: true, message: "Statement PDF regenerated" }), {
          status: 200,
        });
      if (String(url).includes("/webhook/call-now"))
        return new Response(JSON.stringify({ ok: true, reply: "Call started" }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
});

describe("list_issues: two separate lists, never mixed", () => {
  it("customer escalations and system failures apart; no 'not reached' alerts, no info notices", async () => {
    const r = await runAction("list_issues", {}, ctx);
    const d = r.result!.data as {
      customer_escalations: { id: string }[];
      system_notifications: { id: string; category: string }[];
    };
    expect(d.customer_escalations.map((x) => x.id)).toEqual(["ACME-ESC-1"]);
    expect(d.system_notifications.map((x) => x.id)).toEqual(["SYSTEM___workflow-error-1"]);
    expect(d.system_notifications[0]!.category).toBe("Google Drive API quota");
  });
});

describe("diagnose_issue", () => {
  it("system: root cause, execution read attempted (no permission -> a clear note), diagnosis recorded once", async () => {
    const r = await runAction("diagnose_issue", { issue: "SYSTEM-20261118-070033" }, ctx);
    const d = r.result!.data as {
      kind: string;
      diagnosis: { category: string };
      execution: { available: boolean; note: string };
      recorded_in_history: boolean;
    };
    expect(d.kind).toBe("SYSTEM");
    expect(d.diagnosis.category).toBe("Google Drive API quota");
    expect(calls.some((c) => c.url.endsWith("/api/v1/executions/160724?includeData=true"))).toBe(
      true,
    );
    expect(d.execution).toMatchObject({ available: false });
    expect(d.execution.note).toContain("execution:read");
    expect(d.recorded_in_history).toBe(true);
    expect(hook("issue-log")[0]!.body).toMatchObject({
      issue_id: "SYSTEM___workflow-error-1",
      issue_kind: "SYSTEM",
      event: "DIAGNOSIS",
    });
    // the same diagnosis again within 6 hours: not recorded twice
    tables[LOG] = [
      {
        issue_id: "SYSTEM___workflow-error-1",
        event: "DIAGNOSIS",
        summary: String(hook("issue-log")[0]!.body["summary"]),
        timestamp: new Date().toISOString(),
      },
    ];
    calls.length = 0;
    const again = await runAction("diagnose_issue", { issue: "SYSTEM-20261118-070033" }, ctx);
    expect((again.result!.data as { recorded_in_history: boolean }).recorded_in_history).toBe(
      false,
    );
    expect(hook("issue-log")).toHaveLength(0);
  });
  it("customer escalation: type, facts and next steps (kind ESCALATION)", async () => {
    const r = await runAction("diagnose_issue", { issue: "ESC-ACME-1" }, ctx);
    const d = r.result!.data as {
      kind: string;
      diagnosis: { type: string; facts: string[]; next_steps: string[] };
    };
    expect(d.kind).toBe("ESCALATION");
    expect(d.diagnosis.type).toBe("Paid claim");
    expect(d.diagnosis.facts[0]).toContain("PHP 12,000.00");
    expect(d.diagnosis.next_steps[0]).toContain("Zoho Books");
  });
});

describe("changes only after confirmation, and recorded", () => {
  it("update_issue asks first; Done needs a resolution; status + note saved and the resolution recorded", async () => {
    const first = await runAction(
      "update_issue",
      {
        issue: "SYSTEM-20261118-070033",
        status: "DONE",
        resolution: "Waited for the quota, re-ran",
      },
      ctx,
    );
    expect(first.needsConfirmation).toBeTruthy();
    expect(hook("worklist-update")).toHaveLength(0);
    const noRes = await runAction(
      "update_issue",
      { issue: "SYSTEM-20261118-070033", status: "DONE" },
      ctx,
      true,
    );
    expect((noRes.result!.data as { message: string }).message).toContain("final resolution");
    const ok = await runAction(
      "update_issue",
      {
        issue: "SYSTEM-20261118-070033",
        status: "DONE",
        resolution: "Waited for the quota, re-ran",
      },
      ctx,
      true,
    );
    expect((ok.result!.data as { ok: boolean }).ok).toBe(true);
    expect(hook("worklist-update")[0]!.body).toMatchObject({
      entry_id: "SYSTEM___workflow-error-1",
      status: "DONE",
      note: "Resolution: Waited for the quota, re-ran",
    });
    expect(hook("issue-log")[0]!.body).toMatchObject({
      event: "RESOLUTION",
      issue_kind: "SYSTEM",
      summary: "Done: Waited for the quota, re-ran",
    });
  });
  it("run_recovery asks first; then runs the allowed action for the escalation's client and records it", async () => {
    const first = await runAction(
      "run_recovery",
      { action: "refresh_client_from_zoho", issue: "ESC-ACME-1" },
      ctx,
    );
    expect(first.needsConfirmation).toBeTruthy();
    expect(hook("recovery-action")).toHaveLength(0);
    await runAction(
      "run_recovery",
      { action: "regenerate_statement_pdf", issue: "ESC-ACME-1" },
      ctx,
      true,
    );
    expect(hook("recovery-action")[0]!.body).toMatchObject({
      action: "regenerate_statement_pdf",
      client_id: "ACME___a@b.co",
      requested_by: "Tester",
    });
    expect(hook("issue-log")[0]!.body).toMatchObject({
      event: "ACTION",
      issue_kind: "ESCALATION",
      issue_id: "ACME-ESC-1",
    });
    await runAction("run_recovery", { action: "call_again", client: "ACME" }, ctx, true);
    expect(hook("call-now")[0]!.body).toMatchObject({ client_id: "ACME___a@b.co" });
  });
  it("anything outside the allow-list is refused before it reaches n8n", async () => {
    const r = await runAction(
      "run_recovery",
      { action: "send_all_reminders", client: "ACME" },
      ctx,
      true,
    );
    expect(r.ok).toBe(false);
    expect(hook("recovery-action")).toHaveLength(0);
  });
});
