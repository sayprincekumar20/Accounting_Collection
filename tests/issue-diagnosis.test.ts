import { describe, expect, it } from "vitest";
import {
  diagnoseEscalation,
  diagnoseSystem,
  issueKind,
  parseSystemFailure,
} from "../src/lib/issue-diagnosis";

const NOW = Date.parse("2026-11-21T04:00:00Z");
// Real rows from the escalations table (system failures written by [SYSTEM] Error Alert).
const driveQuota = {
  entry_id: "SYSTEM___workflow-error-1794956433422",
  client_id: "SYSTEM___workflow-error",
  client_name: "00_Zoho_Data_Fetch_Master_v3",
  channel: "SYSTEM_ERROR",
  reason:
    "Workflow failed: 00_Zoho_Data_Fetch_Master_v3 - Forbidden - perhaps check your credentials? (Quota exceeded for quota metric 'Queries' and limit 'Previous quota: Requests per minute' of service 'drive.googleapis.com' for consumer 'project_number:498586711441'.)",
  timestamp: "2026-11-18T07:00:33.431+08:00",
  message:
    "🚨 WORKFLOW FAILED\n\nWorkflow: 00_Zoho_Data_Fetch_Master_v3\nFailed at: Search Date Folder\nError: Forbidden - perhaps check your credentials?\nExecution: https://rareglobalfood.app.n8n.cloud/workflow/AdAx7gEP9m53xstX/executions/160724",
};
const mapping = {
  client_id: "SYSTEM___workflow-error",
  channel: "SYSTEM_ERROR",
  reason:
    "Workflow failed: Process One Gmail Reply - Invalid input for 'handoff_mode' [item 0] ('handoff_mode' expects a string but we got 'true')",
  timestamp: "2026-11-12T23:51:47.215+08:00",
  message:
    "🚨 WORKFLOW FAILED\n\nWorkflow: Process One Gmail Reply\nFailed at: Call AR Reply Agent\nError: Invalid input for 'handoff_mode' [item 0]\nExecution: https://rareglobalfood.app.n8n.cloud/workflow/t5Q7LUDfFMiKJd1N/executions/159495",
};
const credentials = {
  client_id: "SYSTEM___workflow-error",
  channel: "SYSTEM_ERROR",
  reason:
    "Workflow failed: 00_Zoho_Data_Fetch_Master_v3 - Forbidden - perhaps check your credentials?",
  timestamp: "2026-11-17T13:00:51.203+08:00",
  message:
    "🚨 WORKFLOW FAILED\n\nWorkflow: 00_Zoho_Data_Fetch_Master_v3\nFailed at: Search Date Folder\nError: Forbidden - perhaps check your credentials?\nExecution: https://rareglobalfood.app.n8n.cloud/workflow/AdAx7gEP9m53xstX/executions/159100",
};

describe("system failures", () => {
  it("reads workflow, failed node, error and execution from the message", () => {
    expect(parseSystemFailure(driveQuota)).toMatchObject({
      workflow: "00_Zoho_Data_Fetch_Master_v3",
      workflow_id: "AdAx7gEP9m53xstX",
      node: "Search Date Folder",
      execution_id: "160724",
    });
    expect(parseSystemFailure(driveQuota).error).toContain("drive.googleapis.com");
  });
  it("Drive quota is recognised before the generic 'check your credentials' text", () => {
    const d = diagnoseSystem(driveQuota, [driveQuota, credentials], NOW);
    expect(d.category).toBe("Google Drive API quota");
    expect(d.root_cause).toContain("Search Date Folder");
    expect(d.recovery).toEqual(["regenerate_statement_pdf"]);
  });
  it("a mapping bug: re-running alone will not help", () => {
    const d = diagnoseSystem(mapping, [], NOW);
    expect(d.category).toBe("Data or mapping error in the workflow");
    expect(d.fixes.join(" ")).toContain("re-running alone will not help");
    expect(d.recovery).toEqual([]);
  });
  it("credential problem is urgent; recurrence counts the same workflow + kind in 7 days", () => {
    const again = { ...credentials, timestamp: "2026-11-19T13:00:51+08:00" };
    const d = diagnoseSystem(credentials, [credentials, again, driveQuota], NOW);
    expect(d.category).toBe("Credentials or access");
    expect(d.severity).toBe("urgent");
    expect(d.recurrence_7d).toBe(2); // the Drive quota one is a different kind
  });
  it("an unknown error still points to the execution", () => {
    const d = diagnoseSystem(
      { ...mapping, reason: "Workflow failed: X - weird", message: "" },
      [],
      NOW,
    );
    expect(d.category).toBe("Unknown");
    expect(d.fixes[0]).toContain("execution link");
  });
});

describe("customer escalations (kept apart from system rows)", () => {
  const client = {
    client_id: "ACME___a@b.co",
    client_name: "ACME",
    collection_amount: 12000,
    overdue_total: 9000,
    promise_suppressed_until: "2026-11-25T00:00:00Z",
    status: "ACTIVE",
  };
  it("issueKind separates the two", () => {
    expect(issueKind(driveQuota)).toBe("SYSTEM");
    expect(
      issueKind({ client_id: "ACME___a@b.co", channel: "EMAIL", reason: "Dispute: wrong amount" }),
    ).toBe("ESCALATION");
  });
  it("paid claim: facts, the client's own words (quoted history cut), and the next steps", () => {
    const d = diagnoseEscalation(
      {
        client_id: "ACME___a@b.co",
        channel: "EMAIL",
        reason: "Client says already paid last Friday",
        timestamp: "2026-11-18T02:00:00Z",
      },
      {
        client,
        conversations: [
          {
            client_id: "ACME___a@b.co",
            channel: "EMAIL",
            direction: "INBOUND",
            timestamp: "2026-11-18T01:59:00Z",
            message_text:
              "We already paid last Friday po\n\nOn Tue, 17 Nov 2026 Grace wrote:\n> reminder",
          },
        ],
        promises: [],
        logs: [
          {
            client_id: "ACME___a@b.co",
            channel: "SMS",
            event_type: "SEND_FAILED",
            timestamp: "2026-11-17T00:00:00Z",
          },
        ],
        now: NOW,
      },
    );
    expect(d.type).toBe("Paid claim");
    expect(d.facts[0]).toBe("Balance PHP 12,000.00, overdue PHP 9,000.00.");
    expect(d.facts.join(" ")).toContain("Payment promise until 2026-11-25");
    expect(d.last_client_messages[0]!.text).toBe("We already paid last Friday po");
    expect(d.next_steps[0]).toContain("Zoho Books");
    expect(d.recovery).toContain("refresh_client_from_zoho");
    expect(d.urgency).toBe("high"); // 3 days old
  });
  it("a Done escalation recommends nothing new", () => {
    const d = diagnoseEscalation(
      {
        client_id: "ACME___a@b.co",
        reason: "Please call me back",
        status: "DONE",
        timestamp: "2026-11-20T00:00:00Z",
      },
      { client, conversations: [], promises: [], logs: [], now: NOW },
    );
    expect(d.type).toBe("Callback");
    expect(d.recovery).toEqual([]);
  });
});
