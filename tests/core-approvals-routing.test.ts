process.env["N8N_APPROVAL_SECRET"] = "test-approval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/n8n-datatable", () => ({
  RECENT_60_DAYS: { sinceDays: 60, dateColumn: "timestamp" },
  fetchAllDataTableRows: async () => [],
  fetchDataTable: async () => ({ rows: [], truncated: false }),
  clearDataTableCache: () => {},
  truncationHeaders: () => ({}),
}));
import { clearSwitchCache } from "../src/lib/core-client";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const post = async (body: unknown) => {
  const mod = (await import("../src/routes/api/contact-approvals.ts")).Route as unknown as {
    options: { server: { handlers: Record<string, Handler> } };
  };
  return mod.options.server.handlers["POST"]!({
    request: new Request("https://dash.example/", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  });
};

const CORE = "https://core.example";
const REQUEST = {
  approved_by: "María Santos",
  items: [{ client_id: "A___x", client_name: "A", approved: true, excluded_invoices: ["7"] }],
};

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let switchMode: string | "down" = "n8n";
let coreApprovals: () => Response | Promise<Response> = () =>
  Response.json({ ok: true, saved: 1, warnings: [] });

const coreCalls = () => calls.filter((c) => c.url === `${CORE}/v1/approvals`);
const n8nCalls = () => calls.filter((c) => c.url.includes("/webhook/contact-approval-update"));
const switchCalls = () => calls.filter((c) => c.url === `${CORE}/v1/switches`);

beforeEach(() => {
  calls = [];
  switchMode = "n8n";
  coreApprovals = () => Response.json({ ok: true, saved: 1, warnings: [] });
  clearSwitchCache();
  delete process.env["CORE_URL"];
  delete process.env["CORE_API_KEY"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      if (String(url) === `${CORE}/v1/switches`) {
        if (switchMode === "down") throw new Error("connect ECONNREFUSED");
        return Response.json({ items: [{ key: "wave1.dashboard_actions", mode: switchMode }] });
      }
      if (String(url) === `${CORE}/v1/approvals`) return coreApprovals();
      if (String(url).includes("/webhook/contact-approval-update"))
        return Response.json({ ok: true, saved: 1 });
      throw new Error("unexpected fetch " + String(url));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
const configured = () => {
  process.env["CORE_URL"] = CORE + "/";
  process.env["CORE_API_KEY"] = "core-key";
};

describe("Contact Approvals: which engine handles the action", () => {
  it("without CORE_URL it is exactly today's behaviour: n8n only, the backend is never contacted", async () => {
    const r = await post(REQUEST);
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Handled-By")).toBe("n8n");
    expect(n8nCalls()).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith(CORE))).toHaveLength(0);
  });

  it("a request without a name is refused before anything is called", async () => {
    configured();
    expect((await post({ items: [{ client_id: "A___x" }] })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("switch on n8n: n8n handles it and the backend does not receive the approval", async () => {
    configured();
    const r = await post(REQUEST);
    expect(r.headers.get("X-Handled-By")).toBe("n8n");
    expect(n8nCalls()).toHaveLength(1);
    expect(coreCalls()).toHaveLength(0);
  });

  it("switch on shadow: n8n handles it as before, and the backend gets a dry run of the same request", async () => {
    configured();
    switchMode = "shadow";
    const r = await post(REQUEST);
    expect(r.headers.get("X-Handled-By")).toBe("n8n");
    expect(n8nCalls()).toHaveLength(1);
    await vi.waitFor(() => expect(coreCalls()).toHaveLength(1));
    const init = coreCalls()[0]!.init!;
    expect(JSON.parse(String(init.body))).toEqual({ items: REQUEST.items, dry_run: true });
  });

  it("a failing shadow run never changes the answer", async () => {
    configured();
    switchMode = "shadow";
    coreApprovals = () => {
      throw new Error("boom");
    };
    const r = await post(REQUEST);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, saved: 1 });
  });

  it("switch on core: the backend handles it with the key and the acting name, n8n is not called", async () => {
    configured();
    switchMode = "core";
    coreApprovals = () =>
      Response.json({ ok: true, saved: 1, warnings: ["Statement PDFs were not started"] });
    const r = await post(REQUEST);
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Handled-By")).toBe("core");
    expect(await r.json()).toEqual({
      ok: true,
      saved: 1,
      warnings: ["Statement PDFs were not started"],
    });
    expect(n8nCalls()).toHaveLength(0);
    const headers = coreCalls()[0]!.init!.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("core-key");
    expect(decodeURIComponent(headers["X-Acting-User"]!)).toBe("María Santos");
    expect(JSON.parse(String(coreCalls()[0]!.init!.body))).toEqual({ items: REQUEST.items });
  });

  it("if the backend cannot be reached, n8n takes over (the team is never blocked)", async () => {
    configured();
    switchMode = "core";
    coreApprovals = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const r = await post(REQUEST);
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Handled-By")).toBe("n8n");
    expect(n8nCalls()).toHaveLength(1);
  });

  it.each([409, 503])(
    "if the backend answers %i (switch moved back / not ready), n8n takes over",
    async (status) => {
      configured();
      switchMode = "core";
      coreApprovals = () => Response.json({ detail: "not now" }, { status });
      const r = await post(REQUEST);
      expect(r.headers.get("X-Handled-By")).toBe("n8n");
      expect(n8nCalls()).toHaveLength(1);
    },
  );

  it("a partly-done answer (502: saved in the backend, n8n tables not updated) is an error and n8n is NOT asked again", async () => {
    configured();
    switchMode = "core";
    coreApprovals = () =>
      Response.json(
        { detail: { message: "saved here, but n8n failed", saved_in_backend: true } },
        { status: 502 },
      );
    const r = await post(REQUEST);
    expect(r.status).toBe(500);
    expect(n8nCalls()).toHaveLength(0);
  });

  it("if the switches cannot be read the dashboard stays on n8n", async () => {
    configured();
    switchMode = "down";
    const r = await post(REQUEST);
    expect(r.headers.get("X-Handled-By")).toBe("n8n");
    expect(coreCalls()).toHaveLength(0);
  });

  it("the switches are read once per 15 seconds, not on every click", async () => {
    configured();
    switchMode = "core";
    await post(REQUEST);
    await post(REQUEST);
    expect(switchCalls()).toHaveLength(1);
    expect(coreCalls()).toHaveLength(2);
  });
});

describe("The AI assistant approves through the same engine and switch", () => {
  it("on n8n it uses n8n; on core it uses the backend with the acting name", async () => {
    const { approveClients } = await import("../src/lib/n8n-actions");
    configured();
    expect(await approveClients("Ana", [{ client_id: "A___x", approved: true }])).toEqual({
      ok: true,
      saved: 1,
    });
    expect(n8nCalls()).toHaveLength(1);
    expect(coreCalls()).toHaveLength(0);

    clearSwitchCache();
    calls = [];
    switchMode = "core";
    expect(await approveClients("María Santos", [{ client_id: "A___x", approved: true }])).toEqual({
      ok: true,
      saved: 1,
    });
    expect(n8nCalls()).toHaveLength(0);
    const headers = coreCalls()[0]!.init!.headers as Record<string, string>;
    expect(decodeURIComponent(headers["X-Acting-User"]!)).toBe("María Santos");
  });

  it("a failure is still an error for the assistant (not swallowed)", async () => {
    const { approveClients } = await import("../src/lib/n8n-actions");
    configured();
    switchMode = "core";
    coreApprovals = () => Response.json({ detail: "partly done" }, { status: 502 });
    await expect(approveClients("Ana", [{ client_id: "A___x", approved: true }])).rejects.toThrow(
      "backend approval failed",
    );
  });
});
