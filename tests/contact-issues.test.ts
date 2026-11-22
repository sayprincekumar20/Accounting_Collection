import { describe, expect, it } from "vitest";
import { classifyContact, inTab } from "../src/lib/contact-issues";

const base = { email: "acct@client.ph", phone: "09171234567", contact_person: "Ana" };
const codes = (o: Partial<typeof base> & { bounce?: string; wrongPerson?: string }) =>
  classifyContact({ ...base, ...o }).issues.map((i) => i.code);

describe("contact problems and reachability", () => {
  it("a complete, valid contact has nothing to fix and is reachable both ways", () => {
    expect(classifyContact(base)).toEqual({ issues: [], reach: { email: true, phone: true } });
  });
  it("no phone and no email: not reachable at all", () => {
    const r = classifyContact({ ...base, email: "", phone: "" });
    expect(r.issues.map((i) => i.code)).toEqual(["NO_CONTACT"]);
    expect(inTab("unreachable", r)).toBe(true);
  });
  it("email only (no mobile): flagged, still reachable by email", () => {
    const r = classifyContact({ ...base, phone: "" });
    expect(r.issues.map((i) => i.code)).toEqual(["NO_MOBILE"]);
    expect(r.reach).toEqual({ email: true, phone: false });
    expect(inTab("phone", r)).toBe(true);
    expect(inTab("unreachable", r)).toBe(false);
  });
  it("bounced email with a valid mobile: an email problem, reachable by SMS / call", () => {
    const r = classifyContact({ ...base, bounce: "Email bounced: address not found (Nov 13)" });
    expect(r.issues[0]).toMatchObject({ code: "BOUNCED", detail: "address not found (Nov 13)" });
    expect(r.reach).toEqual({ email: false, phone: true });
    expect(inTab("email", r)).toBe(true);
  });
  it("bounced email and an invalid phone: can't be reached", () => {
    const r = classifyContact({ ...base, phone: "63962051595", bounce: "Email bounced: blocked" });
    expect(r.issues.map((i) => i.code)).toEqual(["BOUNCED", "BAD_PHONE"]);
    expect(inTab("unreachable", r)).toBe(true);
  });
  it("placeholder, internal and invalid emails; no contact person; wrong person", () => {
    expect(codes({ email: "maukas@fake.com" })).toEqual(["FAKE_EMAIL"]);
    expect(codes({ email: "ar@rareglobalfood.com" })).toEqual(["INTERNAL_EMAIL"]);
    expect(codes({ email: "ana@client" })).toEqual(["INVALID_EMAIL"]);
    expect(codes({ contact_person: "" })).toEqual(["NO_PERSON"]);
    expect(codes({ wrongPerson: "Client said wrong person" })).toEqual(["WRONG_PERSON"]);
  });
});
