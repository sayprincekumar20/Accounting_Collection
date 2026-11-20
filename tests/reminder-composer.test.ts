// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReminderComposer } from "../src/components/assistant/ReminderComposer";

const SMS =
  "Hi Ana, you have 1 overdue invoice with Rare Global Food Trading Corp totaling PHP 60.00. Please settle or reply with your payment date. Thank you!";
const preview = (warnings: string[] = []) => ({
  client: {
    client_id: "A___1",
    client_name: "Alpha Corp",
    contact_person: "Ana",
    email: "a@b.co",
    phone: "639170000000",
    overdue: 60,
    current: 0,
    total: 60,
    pdf_generated_date: "",
  },
  blocked: "",
  warnings,
  channels: {
    EMAIL: {
      available: false,
      reason: "No statement PDF yet (it is made by the Zoho refresh)",
      attachment: "",
      editable: true,
      template: { subject: "Alpha Corp_SOA (11.19.26)", body: "Hi Ma'am/Sir" },
    },
    SMS: {
      available: true,
      reason: "",
      attachment: "",
      editable: true,
      template: { subject: "", body: SMS },
    },
    VIBER: {
      available: true,
      reason: "",
      attachment: "+ statement PDF (made November 18, 2026)",
      editable: true,
      template: { subject: "", body: "Hello Ana, as of ..." },
    },
    WHATSAPP: {
      available: true,
      reason: "",
      attachment: "+ statement PDF (made November 18, 2026)",
      editable: false,
      template: {
        subject: "",
        body: "Hello Ana, as of November 18, 2026 your account statement ...",
      },
    },
  },
});
let sent: Record<string, unknown> | null = null;
let warnings: string[] = [];
beforeEach(() => {
  sent = null;
  warnings = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/reminder/preview"))
      return new Response(JSON.stringify(preview(warnings)), { status: 200 });
    if (String(url) === "/api/reminder/send") {
      sent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ status: "sent", message: "SMS reminder sent successfully" }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
});
afterEach(() => cleanup());
const mount = (channel?: "SMS" | "WHATSAPP") =>
  render(
    createElement(ReminderComposer, {
      clientId: "A___1",
      initialChannel: channel,
      getUserName: () => "Tester",
    }),
  );

describe("Reminder composer", () => {
  it("loads the approved template of the chosen channel; edits are marked and can be undone", async () => {
    mount("SMS");
    const box = (await screen.findByLabelText("Message")) as HTMLTextAreaElement;
    expect(box.value).toBe(SMS);
    expect(screen.getByText(/Approved template for this channel/)).toBeTruthy();
    fireEvent.change(box, {
      target: { value: "Hi Ana, a gentle reminder about PHP 60.00. Thank you!" },
    });
    expect(screen.getByText("Edited from the approved template.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to the approved template/ }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(SMS);
  });

  it("checks the channel rules while typing (SMS: no ₱, one SMS) and blocks sending", async () => {
    mount("SMS");
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Pay ₱60 please" },
    });
    expect(screen.getByLabelText("Channel rules").textContent).toContain("₱");
    expect(
      (screen.getByRole("button", { name: /Review and send/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows why a channel is unavailable, and WhatsApp's approved template is locked", async () => {
    mount("WHATSAPP");
    await screen.findByText(/Meta-approved templates/);
    expect(screen.queryByLabelText("Message")).toBeNull(); // not editable
    expect(screen.getByText(/Email unavailable: No statement PDF yet/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Email" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for confirmation (warnings must be ticked) and sends the edited text", async () => {
    warnings = ["Payment promise until 2026-11-24: automatic reminders are paused."];
    mount("SMS");
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi Ana, a gentle reminder about PHP 60.00. Thank you!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Review and send/ }));
    expect(screen.getByText(/Send this SMS reminder to 639170000000\?/)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: /Confirm and send/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // warning not acknowledged yet
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByText(/Sent: SMS reminder sent successfully/)).toBeTruthy(),
    );
    expect(sent).toMatchObject({
      client_id: "A___1",
      channel: "SMS",
      body: "Hi Ana, a gentle reminder about PHP 60.00. Thank you!",
      acknowledged: true,
      requested_by: "Tester",
    });
  });
});
