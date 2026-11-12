// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContactClientDialog } from "../src/components/collections/ContactClientDialog";
import { CallAgainButton } from "../src/components/collections/CallAgainButton";

const client = {
  client_id: "102 IZAKAYA___639108278710",
  client_name: "102 IZAKAYA",
  contact_person: "Mira",
  email: "acct@izakaya.ph",
  phone: "639108278710",
};
let posts: { url: string; body: Record<string, unknown> }[] = [];
let viberConvs: unknown[] = [];
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  posts = [];
  viberConvs = [];
  sessionStorage.clear();
  window.prompt = () => "Tester";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") {
      posts.push({ url: u, body: JSON.parse(String(init.body)) });
      if (u.includes("call-now"))
        return json({ ok: true, reply: "Calling 102 IZAKAYA now (Grace)." });
      return json({ ok: true });
    }
    if (u.includes("viber-conversations")) return json({ conversations: viberConvs });
    if (u.includes("sms-conversations")) return json({ conversations: [] });
    if (u.includes("gmail-threads-list"))
      return json({
        threads: [
          {
            thread_id: "T9",
            client_id: "102 IZAKAYA___acct@izakaya.ph",
            lastMessageAt: "2026-11-12T05:01:00Z",
            lastMessagePreview: "SOA attached",
          },
        ],
      });
    return json({}, 404);
  }) as typeof fetch;
});
afterEach(() => cleanup());

const mount = (c = client) =>
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(ContactClientDialog, { client: c, onClose: () => {} }),
    ),
  );

describe("Contact dialog (Clients module)", () => {
  it("disables the channels the client cannot be reached on, and says why", () => {
    mount({ ...client, email: "", phone: "63915453708" });
    for (const name of ["Viber", "SMS", "WhatsApp", "Email", "Call"])
      expect(screen.getByRole("button", { name: new RegExp(`^${name}$`) })).toHaveProperty(
        "disabled",
        true,
      );
    expect(document.body.textContent).toContain("no email on file");
    expect(document.body.textContent).toContain("phone number is not a valid PH mobile");
  });

  it("Viber with an existing conversation: link opens it on the Viber page", async () => {
    viberConvs = [
      {
        client_id: "639108278710",
        lastMessageAt: "2026-11-12T05:03:00Z",
        messages: [{ content: "Hi Mira" }],
      },
    ];
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Viber$/ }));
    const link = await screen.findByRole("link", { name: "Open the conversation" });
    expect(link.getAttribute("href")).toBe("/viber?open=639108278710");
    expect(document.body.textContent).toContain("Hi Mira");
  });

  it("Viber without a conversation: the first message can be sent from the dialog", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Viber$/ }));
    await screen.findByText(/No Viber conversation with this client yet/);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello from AR" } });
    fireEvent.click(screen.getByRole("button", { name: /Send Viber/ }));
    await screen.findByText(/Sent\./);
    expect(posts[0]).toEqual({
      url: "/api/viber-send",
      body: { phone: "639108278710", message: "Hello from AR", clientId: client.client_id },
    });
  });

  it("Email: opens the client's most recent thread", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Email$/ }));
    const link = await screen.findByRole("link", { name: "Open the conversation" });
    expect(link.getAttribute("href")).toBe("/email?open=T9");
  });

  it("WhatsApp starts with the approved template (WhatsApp rule), by client id", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^WhatsApp$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Send the WhatsApp reminder/ }));
    await screen.findByText(/Sent\./);
    expect(posts[0]).toEqual({
      url: "/api/whatsapp-template",
      body: { client_id: client.client_id },
    });
  });
});

describe("Call again button", () => {
  const mountBtn = () =>
    render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(CallAgainButton, {
          clientId: client.client_id,
          clientName: client.client_name,
        }),
      ),
    );
  it("needs a second click to confirm; Cancel places nothing", () => {
    mountBtn();
    fireEvent.click(screen.getByRole("button", { name: /Call again/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(posts).toHaveLength(0);
  });
  it("confirm calls /api/call-now with the client and the person's name, and shows the result", async () => {
    mountBtn();
    fireEvent.click(screen.getByRole("button", { name: /Call again/ }));
    fireEvent.click(screen.getByRole("button", { name: /Call 102 IZAKAYA\?/ }));
    await screen.findByText(/Calling 102 IZAKAYA now/);
    expect(posts).toEqual([
      { url: "/api/call-now", body: { client_id: client.client_id, requested_by: "Tester" } },
    ]);
  });
});
