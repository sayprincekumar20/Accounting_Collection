import { describe, expect, it } from "vitest";
import {
  channelOptions,
  findEmailThread,
  findPhoneConversation,
  normalizePhMobile,
} from "../src/lib/contact-channels";

const client = {
  client_id: "102 IZAKAYA___639108278710",
  client_name: "102 IZAKAYA",
  email: "acct@izakaya.ph",
  phone: "0910 827 8710",
};

describe("normalizePhMobile", () => {
  it("accepts the usual Philippine formats", () => {
    expect(normalizePhMobile("09108278710")).toBe("639108278710");
    expect(normalizePhMobile("+63 910 827 8710")).toBe("639108278710");
    expect(normalizePhMobile("9108278710")).toBe("639108278710");
  });
  it("refuses numbers one digit short or landlines", () => {
    expect(normalizePhMobile("63915453708")).toBe(""); // Shang Global City
    expect(normalizePhMobile("028123456")).toBe("");
    expect(normalizePhMobile("")).toBe("");
  });
});

describe("channelOptions", () => {
  it("all channels when email and mobile are valid", () => {
    expect(channelOptions(client).every((o) => o.available)).toBe(true);
  });
  it("explains why a channel is unavailable", () => {
    const o = channelOptions({ ...client, email: "", phone: "63915453708" });
    expect(o.find((x) => x.channel === "email")).toMatchObject({
      available: false,
      why: "no email on file",
    });
    expect(o.find((x) => x.channel === "viber")).toMatchObject({
      available: false,
      why: "phone number is not a valid PH mobile",
    });
    expect(o.find((x) => x.channel === "call")!.available).toBe(false);
  });
});

describe("finding the recent conversation", () => {
  it("phone channels: last 10 digits, most recent wins, preview of the last message", () => {
    const convs = [
      {
        client_id: "639108278710",
        lastMessageAt: "2026-11-01T00:00:00Z",
        messages: [{ content: "old" }],
      },
      {
        client_id: "09108278710",
        lastMessageAt: "2026-11-12T05:03:00Z",
        messages: [{ content: "a" }, { content: "Hi Mira, reminder" }],
      },
      { client_id: "639999999999", lastMessageAt: "2026-11-12T06:00:00Z", messages: [] },
      null,
    ];
    expect(findPhoneConversation(client, convs)).toEqual({
      open: "09108278710",
      lastAt: "2026-11-12T05:03:00Z",
      preview: "Hi Mira, reminder",
    });
    expect(findPhoneConversation({ ...client, phone: "" }, convs)).toBeNull();
  });
  it("email: same company (any contact group), most recent thread", () => {
    const threads = [
      {
        thread_id: "T1",
        client_id: "102 IZAKAYA___old@izakaya.ph",
        lastMessageAt: "2026-10-01T00:00:00Z",
        lastMessagePreview: "old",
      },
      {
        thread_id: "T2",
        client_id: "102 izakaya___acct@izakaya.ph",
        lastMessageAt: "2026-11-12T05:01:00Z",
        lastMessagePreview: "SOA attached",
      },
      {
        thread_id: "T3",
        client_id: "OTHER___x",
        lastMessageAt: "2026-11-12T07:00:00Z",
        lastMessagePreview: "x",
      },
    ];
    expect(findEmailThread(client, threads)).toEqual({
      open: "T2",
      lastAt: "2026-11-12T05:01:00Z",
      preview: "SOA attached",
    });
    expect(findEmailThread(client, [])).toBeNull();
  });
});
