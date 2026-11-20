import { describe, expect, it } from "vitest";
import {
  channelAvailability,
  emailTemplate,
  nonGsmChars,
  smsLength,
  smsTemplate,
  validateReminder,
  viberTemplate,
  whatsappPreview,
  type ReminderClient,
} from "../src/lib/reminder-templates";

const NOW = Date.UTC(2026, 10, 19, 6, 0); // Thu Nov 19, 2026 2:00 PM Manila
const client = (o: Partial<ReminderClient> = {}): ReminderClient => ({
  client_id: "RASPBERRY KITCHEN___x",
  client_name: "RASPBERRY KITCHEN",
  contact_person: "Dianne Cruz",
  email: "acct@raspberry.ph",
  phone: "09171234567",
  overdue: 512.84,
  current: 0,
  total: 512.84,
  invoice_statuses: ["OVERDUE"],
  pdf_file_id: "1UGf",
  pdf_generated_date: "2026-11-18T01:25:07.385Z",
  ...o,
});

describe("approved templates (identical to the n8n workflows)", () => {
  it("SMS: the real message sent to Raspberry Kitchen", () => {
    expect(smsTemplate(client()).body).toBe(
      "Hi Dianne, you have 1 overdue invoice with Rare Global Food Trading Corp totaling PHP 512.84. Please settle or reply with your payment date. Thank you!",
    );
  });
  it("SMS: long version shortens step by step and always fits one SMS", () => {
    const body = smsTemplate(
      client({
        contact_person: "",
        total: 364615.17,
        invoice_statuses: [...Array(4).fill("OVERDUE"), ...Array(6).fill("CURRENT")],
      }),
    ).body;
    expect(body).toBe(
      // the real message from the n8n run: "Thank you!" would make it 157 characters, so it is dropped
      "Hi, you have 4 overdue invoices and 6 current invoices with Rare Global Food totaling PHP 364,615.17. Please settle or reply with your payment date.",
    );
    expect(smsLength(body)).toBeLessThanOrEqual(155);
  });
  it("Email: '{CLIENT}_SOA (MM.DD.YY)' (Manila date) and the short SOA follow-up", () => {
    const e = emailTemplate(client(), NOW);
    expect(e.subject).toBe("RASPBERRY KITCHEN_SOA (11.19.26)");
    expect(e.body).toContain(
      "Would like to follow up if we have available collection on the overdue invoices.",
    );
    expect(e.body.endsWith("Accounts Receivable Department")).toBe(true);
  });
  it("Viber: the statement text with overdue / current / total", () => {
    expect(viberTemplate(client({ current: 100, total: 612.84 }), NOW).body).toBe(
      "Hello Dianne Cruz, as of November 19, 2026, your account statement from Rare Global Food Trading Corp. shows:\n\nOverdue balance: PHP 512.84\nCurrent balance: PHP 100.00\nTotal balance: PHP 612.84\n\nPlease see the attached statement for details. Thank you.",
    );
  });
  it("WhatsApp: the approved template, dated like the statement PDF", () => {
    expect(whatsappPreview(client(), NOW).body).toBe(
      "Hello Dianne Cruz, as of November 18, 2026 your account statement from Rare Global Food Trading Corp. shows: Overdue balance: PHP 512.84. Current balance: PHP 0.00. Total balance: PHP 512.84. Please see the attached statement for details.",
    );
  });
});

describe("channel rules for an edited message", () => {
  it("SMS: one SMS only, GSM characters only, no links", () => {
    expect(validateReminder("SMS", { subject: "", body: "Hi, you owe ₱500. Thanks 🙏" })).toEqual([
      expect.stringContaining("₱ 🙏"),
    ]);
    expect(validateReminder("SMS", { subject: "", body: "x".repeat(156) })[0]).toContain(
      "156 of 155",
    );
    expect(nonGsmChars("Hello “quoted”")).toEqual(["“", "”"]);
    expect(
      validateReminder("SMS", { subject: "", body: "Pay at https://pay.example.com" })[0],
    ).toContain("Links are not allowed");
    expect(
      validateReminder("SMS", { subject: "", body: "Hi, please settle PHP 512.84. Thank you!" }),
    ).toEqual([]);
  });
  it("Email: subject required and one line; Viber: max 1000; WhatsApp: never edited", () => {
    expect(validateReminder("EMAIL", { subject: "", body: "Hello" })).toContain(
      "The subject is empty.",
    );
    expect(validateReminder("EMAIL", { subject: "A\nB", body: "Hello" })).toContain(
      "The subject must be one line.",
    );
    expect(validateReminder("VIBER", { subject: "", body: "y".repeat(1001) })[0]).toContain(
      "1001 of 1000",
    );
    expect(validateReminder("WHATSAPP", { subject: "", body: "" })).toEqual([]);
    expect(validateReminder("EMAIL", { subject: "S", body: "" })).toContain(
      "The message is empty.",
    );
  });
});

describe("which channels can reach the client", () => {
  it("email needs an address and the statement PDF; SMS/Viber need a valid PH mobile", () => {
    expect(channelAvailability("EMAIL", client({ email: "" }), NOW)).toMatchObject({
      available: false,
    });
    expect(channelAvailability("EMAIL", client({ pdf_file_id: "" }), NOW).reason).toContain(
      "No statement PDF",
    );
    expect(channelAvailability("SMS", client({ phone: "63962051595" }), NOW).reason).toContain(
      "not a valid PH mobile",
    );
    expect(channelAvailability("VIBER", client({ pdf_file_id: "" }), NOW)).toMatchObject({
      available: true,
      attachment: "no statement PDF yet: text only",
    });
  });
  it("WhatsApp needs a statement PDF made in the last 8 days", () => {
    expect(channelAvailability("WHATSAPP", client(), NOW).available).toBe(true);
    expect(
      channelAvailability("WHATSAPP", client({ pdf_generated_date: "2026-11-01T00:00:00Z" }), NOW)
        .available,
    ).toBe(false);
  });
});
