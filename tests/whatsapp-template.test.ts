process.env.N8N_APPROVAL_SECRET = "test-approval";
process.env.N8N_CONTACT_SECRET = "test-contact";
process.env.N8N_WORKLIST_SECRET = "test-worklist";
process.env.N8N_WA_REMINDER_KEY = "test-wa";
import { afterEach, describe, expect, it, vi } from "vitest";

type H = { POST: (c: { request: Request }) => Promise<Response> };
const handlers = async () =>
  (
    (await import("../src/routes/api/whatsapp-template")).Route as unknown as {
      options: { server: { handlers: H } };
    }
  ).options.server.handlers;
const post = (body: unknown) =>
  new Request("https://x/api/whatsapp-template", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/whatsapp-template (existing n8n template workflow)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the client to the n8n webhook and reports success", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: "success", sid: "SM1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await (
      await (
        await handlers()
      ).POST({ request: post({ client_id: "ZOHO FORM TEST ACCOUNT___pk@x.com" }) })
    ).json();
    expect(r).toMatchObject({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/webhook/whatsapp-reminder");
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: "ZOHO FORM TEST ACCOUNT___pk@x.com",
    });
  });

  it("shows the workflow's reason when it does not send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: "error",
              wa_skip_reason: "statement PDF missing or older than 8 days",
            }),
            { status: 200 },
          ),
      ),
    );
    const r = await (
      await (await handlers()).POST({ request: post({ client_id: "A___a" }) })
    ).json();
    expect(r.ok).toBe(false);
    expect(r.note).toContain("statement PDF missing");
  });

  it("refuses a phone number instead of a client_id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await (await handlers()).POST({ request: post({ client_id: "639173249458" }) });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a client_id", async () => {
    expect((await (await handlers()).POST({ request: post({}) })).status).toBe(400);
  });
});
