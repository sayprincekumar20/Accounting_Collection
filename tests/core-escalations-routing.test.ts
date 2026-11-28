process.env["N8N_WORKLIST_SECRET"] = "test-worklist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No real data, no network: every call below goes to this stand-in. Nothing here can message or call anyone.
vi.mock("../src/lib/n8n-datatable", () => ({
  RECENT_60_DAYS: { sinceDays: 60, dateColumn: "timestamp" },
  fetchAllDataTableRows: async () => [],
  fetchDataTable: async () => ({ rows: [], truncated: false }),
  clearDataTableCache: () => {},
  truncationHeaders: () => ({}),
}));
import { clearSwitchCache } from "../src/lib/core-client";
import { saveIssueEvent, saveIssueStatus } from "../src/lib/issues-engine";
import { logIssueEvent, updateIssueStatus } from "../src/lib/n8n-actions";

const CORE = "https://core.example";
type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let mode: string | "down" = "n8n";
let coreStatus: () => Response | Promise<Response>;
let coreEvent: () => Response | Promise<Response>;
let n8nUpdated = 1;

const by = (part: string) => calls.filter((c) => c.url.includes(part));
const body = (c: Call) => JSON.parse(String(c.init?.body));
const headers = (c: Call) => c.init?.headers as Record<string, string>;

beforeEach(() => {
  calls = [];
  mode = "n8n";
  n8nUpdated = 1;
  coreStatus = () => Response.json({ ok: true, updated: 1, dry_run: false });
  coreEvent = () => Response.json({ ok: true, dry_run: false });
  clearSwitchCache();
  delete process.env["CORE_URL"];
  delete process.env["CORE_API_KEY"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, ...(init ? { init } : {}) });
      if (u === `${CORE}/v1/switches`) {
        if (mode === "down") throw new Error("connect ECONNREFUSED");
        return Response.json({ items: [{ key: "wave1.escalations", mode }] });
      }
      if (u === `${CORE}/v1/escalations/status`) return coreStatus();
      if (u === `${CORE}/v1/issues/events`) return coreEvent();
      if (u.endsWith("/webhook/worklist-update"))
        return Response.json({ ok: true, updated: n8nUpdated });
      if (u.endsWith("/webhook/issue-log")) return Response.json({ ok: true, id: 1 });
      throw new Error("unexpected fetch " + u);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
const configured = () => {
  process.env["CORE_URL"] = CORE;
  process.env["CORE_API_KEY"] = "core-key";
};
const STATUS = {
  entryId: "E1",
  status: "DONE" as const,
  handledBy: "María Santos",
  note: "Documents sent",
};
const EVENT = {
  issue_id: "E1", issue_kind: "ESCALATION" as const, ref: "R1", event: "RESOLUTION" as const,
  summary: "Done: Documents sent", detail: { status: "DONE" }, actor: "María Santos",
}; // prettier-ignore

describe("Escalation status: which engine handles it", () => {
  it("without CORE_URL it is today's behaviour: n8n workflow 27 only", async () => {
    const r = await saveIssueStatus(STATUS);
    expect(r).toEqual({ updated: 1, handledBy: "n8n" });
    expect(by("/webhook/worklist-update")).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith(CORE))).toHaveLength(0);
    expect(body(by("/webhook/worklist-update")[0]!)).toEqual({
      entry_id: "E1", status: "DONE", handled_by: "María Santos", note: "Documents sent",
    }); // prettier-ignore
  });

  it("switch on n8n: n8n only", async () => {
    configured();
    expect((await saveIssueStatus(STATUS)).handledBy).toBe("n8n");
    expect(by("/v1/escalations/status")).toHaveLength(0);
  });

  it("shadow: n8n as before, plus a dry run of the same request in the backend", async () => {
    configured();
    mode = "shadow";
    expect((await saveIssueStatus(STATUS)).handledBy).toBe("n8n");
    await vi.waitFor(() => expect(by("/v1/escalations/status")).toHaveLength(1));
    expect(body(by("/v1/escalations/status")[0]!)).toEqual({
      entry_id: "E1", status: "DONE", note: "Documents sent", dry_run: true,
    }); // prettier-ignore
  });

  it("core: the backend does it with the key and the acting name; n8n is not called", async () => {
    configured();
    mode = "core";
    expect(await saveIssueStatus(STATUS)).toEqual({ updated: 1, handledBy: "core" });
    expect(by("/webhook/worklist-update")).toHaveLength(0);
    const c = by("/v1/escalations/status")[0]!;
    expect(headers(c)["X-API-Key"]).toBe("core-key");
    expect(decodeURIComponent(headers(c)["X-Acting-User"]!)).toBe("María Santos");
    expect(body(c)).toEqual({ entry_id: "E1", status: "DONE", note: "Documents sent" });
  });

  it("core: an unknown escalation comes back as 0 updated", async () => {
    configured();
    mode = "core";
    coreStatus = () => Response.json({ ok: true, updated: 0 });
    expect((await saveIssueStatus(STATUS)).updated).toBe(0);
  });

  it("backend unreachable, or 409 / 503: n8n takes over (the team is never blocked)", async () => {
    configured();
    mode = "core";
    for (const fail of [
      () => {
        throw new Error("connect ECONNREFUSED");
      },
      () => Response.json({}, { status: 409 }),
      () => Response.json({}, { status: 503 }),
    ]) {
      // prettier-ignore
      calls = [];
      coreStatus = fail;
      expect((await saveIssueStatus(STATUS)).handledBy).toBe("n8n");
      expect(by("/webhook/worklist-update")).toHaveLength(1);
    }
  });

  it("any other backend failure (502) is an error and n8n is not asked instead", async () => {
    configured();
    mode = "core";
    coreStatus = () => Response.json({ detail: { saved_in_backend: false } }, { status: 502 });
    await expect(saveIssueStatus(STATUS)).rejects.toThrow("failed (502)");
    expect(by("/webhook/worklist-update")).toHaveLength(0);
  });

  it("an empty name is stamped as 'dashboard' (the backend needs a name)", async () => {
    configured();
    mode = "core";
    await saveIssueStatus({ ...STATUS, handledBy: "  " });
    expect(decodeURIComponent(headers(by("/v1/escalations/status")[0]!)["X-Acting-User"]!)).toBe(
      "dashboard",
    );
  });
});

describe("Issue history: which engine handles it", () => {
  it("n8n (no backend, or switch on n8n) gets today's body with the detail as text", async () => {
    await saveIssueEvent(EVENT);
    configured();
    await saveIssueEvent(EVENT);
    const sent = by("/webhook/issue-log");
    expect(sent).toHaveLength(2);
    expect(body(sent[0]!)).toMatchObject({
      issue_id: "E1",
      event: "RESOLUTION",
      detail: '{"status":"DONE"}',
    });
    expect(by("/v1/issues/events")).toHaveLength(0);
  });

  it("shadow: n8n plus a dry run; core: the backend only", async () => {
    configured();
    mode = "shadow";
    expect((await saveIssueEvent(EVENT)).handledBy).toBe("n8n");
    await vi.waitFor(() => expect(by("/v1/issues/events")).toHaveLength(1));
    expect(body(by("/v1/issues/events")[0]!)).toMatchObject({
      dry_run: true,
      detail: { status: "DONE" },
    });

    clearSwitchCache();
    calls = [];
    mode = "core";
    expect((await saveIssueEvent(EVENT)).handledBy).toBe("core");
    expect(by("/webhook/issue-log")).toHaveLength(0);
    expect(decodeURIComponent(headers(by("/v1/issues/events")[0]!)["X-Acting-User"]!)).toBe(
      "María Santos",
    );
  });

  it("an unreachable backend falls back to n8n; a partly-done answer is an error", async () => {
    configured();
    mode = "core";
    coreEvent = () => { throw new Error("connect ECONNREFUSED"); }; // prettier-ignore
    expect((await saveIssueEvent(EVENT)).handledBy).toBe("n8n");
    calls = [];
    coreEvent = () => Response.json({ detail: { saved_in_backend: true } }, { status: 502 });
    await expect(saveIssueEvent(EVENT)).rejects.toThrow("failed (502)");
    expect(by("/webhook/issue-log")).toHaveLength(0);
  });
});

describe("The Escalations screen and the AI assistant follow the same switch", () => {
  const post = async (payload: unknown) => {
    const mod = (await import("../src/routes/api/worklist.ts")).Route as unknown as {
      options: {
        server: { handlers: Record<string, (c: { request: Request }) => Promise<Response>> };
      };
    };
    return mod.options.server.handlers["POST"]!({
      request: new Request("https://dash.example/", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      }),
    });
  };
  const SCREEN = {
    entry_id: "E1",
    status: "done",
    handled_by: "María Santos",
    note: "Documents sent",
    issue_kind: "ESCALATION",
    ref: "R1",
  };

  it("on n8n: workflow 27 then workflow 33, exactly as before", async () => {
    const r = await post(SCREEN);
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.url.split("/webhook/")[1])).toEqual(["worklist-update", "issue-log"]);
    expect(body(by("/webhook/issue-log")[0]!)).toMatchObject({
      event: "RESOLUTION",
      summary: "Done: Documents sent",
      actor: "María Santos",
    });
  });

  it("on core: the status and the history line both go to the backend, nothing to n8n", async () => {
    configured();
    mode = "core";
    const r = await post(SCREEN);
    expect(r.status).toBe(200);
    expect(by("/v1/escalations/status")).toHaveLength(1);
    expect(by("/v1/issues/events")).toHaveLength(1);
    expect(by("/webhook/")).toHaveLength(0);
  });

  it("an escalation that no longer exists is still a 404 and writes no history", async () => {
    configured();
    mode = "core";
    coreStatus = () => Response.json({ ok: true, updated: 0 });
    expect((await post(SCREEN)).status).toBe(404);
    expect(by("/v1/issues/events")).toHaveLength(0);
  });

  it("the assistant's status and history helpers use the same engine", async () => {
    configured();
    mode = "core";
    expect(await updateIssueStatus("E1", "IN_PROGRESS", "Ana", "looking")).toBe(1);
    await logIssueEvent({ ...EVENT, event: "STATUS", actor: "Ana" });
    expect(by("/v1/escalations/status")).toHaveLength(1);
    expect(by("/v1/issues/events")).toHaveLength(1);
    expect(by("/webhook/")).toHaveLength(0);
  });
});
