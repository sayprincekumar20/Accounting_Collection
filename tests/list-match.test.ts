import { describe, expect, it } from "vitest";
import {
  assessClient,
  matchRows,
  normalizeName,
  outsideOfficeHours,
  parseSheetRows,
  similarity,
  summarize,
  survivesNameSplit,
  type FileRow,
  type MatchClient,
} from "../src/lib/assistant/list-match";

const NOW = Date.UTC(2026, 10, 12, 2, 0, 0);

const client = (o: Partial<MatchClient> = {}): MatchClient => ({
  client_id: "ACME TRADING___a@acme.com",
  client_name: "ACME Trading",
  parent_name: "ACME Trading Inc.",
  contact_person: "Ana",
  email: "a@acme.com",
  phone: "639171234567",
  ar_owner: "Dave",
  sales_person: "Sam",
  collection_schedule: "",
  overdue: 1000,
  current: 500,
  total: 1500,
  branch_count: 1,
  multibranch: false,
  approved: false,
  allow_multibranch: false,
  text_this_cycle: false,
  call_this_cycle: false,
  promise_until: "",
  ar_handoff_until: "",
  sales_team: true,
  internal_account: false,
  invoices: [
    {
      branch: "ACME Trading Makati",
      number: "INV-1",
      due: "2026-10-01",
      balance: 1000,
      status: "OVERDUE",
      counter: "",
    },
  ],
  ...o,
});
const row = (name: string, amount: number | null = null, n = 4): FileRow => ({
  row: n,
  name,
  owner: "Dave",
  amount,
  remarks: "",
});

describe("parseSheetRows (layout of the AR follow-up workbook)", () => {
  const sheet = [
    ["Accounts for Follow-up (Email and Call)", null, null, null],
    [null, null, null, null],
    ["Account owner", "Customer Name", "Total Overdue Balance", "Remarks"],
    ["Dave", "Carl Trading", 1775, null],
    ["Dave", "Daily Dynamis Corporation", "3,821.90", "call first"],
    ["Dave", "carl trading", 1775, null], // repeated name
    ["Dave", "TOTAL", 5596.9, null],
    [null, null, null, null],
    [null, "", null, null],
  ];
  it("finds the header below the title rows and reads owner, amount and remarks", () => {
    const { rows, note } = parseSheetRows(sheet);
    expect(rows.map((r) => r.name)).toEqual(["Carl Trading", "Daily Dynamis Corporation"]);
    expect(rows[0]).toMatchObject({ row: 4, owner: "Dave", amount: 1775 });
    expect(rows[1]).toMatchObject({ amount: 3821.9, remarks: "call first" });
    expect(note).toContain("1 repeated name");
  });
  it("explains when there is no customer column", () => {
    const r = parseSheetRows([
      ["Name", "Amount"],
      ["x", 1],
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.note).toContain("Customer");
  });
  it("accepts a plain CUSTOMER header on the first row (like the Cliq command did)", () => {
    const r = parseSheetRows([["CUSTOMER"], ["Alpha Foods Inc."], ["Beta Meats Corp"]]);
    expect(r.rows.map((x) => x.name)).toEqual(["Alpha Foods Inc.", "Beta Meats Corp"]);
  });
});

describe("normalizeName / similarity", () => {
  it("ignores case, punctuation and legal endings", () => {
    expect(normalizeName("Aji-No-Chinmi Co., Inc.")).toBe("aji no chinmi");
    expect(normalizeName("EDSA SHANGRI-LA HOTEL & RESORT INC")).toBe(
      "edsa shangri la hotel and resort",
    );
    expect(normalizeName("The Daily Dynamis Corporation")).toBe("daily dynamis");
  });
  it("scores token overlap", () => {
    expect(similarity(["a", "b", "c"], ["a", "b", "c"]).score).toBe(1);
    expect(similarity(["a", "b"], ["c", "d"]).score).toBe(0);
  });
});

describe("matchRows", () => {
  const clients = [
    client(),
    client({
      client_id: "CARL___c@x.com",
      client_name: "Carl Trading",
      parent_name: "",
      invoices: [],
    }),
    client({
      client_id: "AURO___a@auro.com",
      client_name: "Auro Chocolate Cafe Inc.",
      parent_name: "Auro Chocolate",
      invoices: [
        {
          branch: "Auro Chocolate Cafe Inc. (Makati) - Commissary",
          number: "A1",
          due: "2026-10-01",
          balance: 10,
          status: "OVERDUE",
          counter: "",
        },
      ],
    }),
    client({
      client_id: "RIVER1___r@x.com",
      client_name: "River Garden Foods",
      parent_name: "",
      invoices: [],
    }),
    client({
      client_id: "RIVER2___r2@x.com",
      client_name: "River Garden Foods Corp",
      parent_name: "",
      invoices: [],
    }),
  ];
  it("matches by client name, parent name and branch name, ignoring legal endings", () => {
    const r = matchRows(
      [
        row("ACME TRADING INC"),
        row("carl trading", null, 5),
        row("Auro Chocolate Cafe Inc. (Makati) - Commissary", null, 6),
      ],
      clients,
      NOW,
    );
    expect(r.map((x) => [x.file.name, x.match, x.client?.client_name])).toEqual([
      ["ACME TRADING INC", "exact", "ACME Trading"],
      ["carl trading", "exact", "Carl Trading"],
      ["Auro Chocolate Cafe Inc. (Makati) - Commissary", "exact", "Auro Chocolate Cafe Inc."],
    ]);
  });
  it("accepts a very similar name only as a possible match (never pre-selected)", () => {
    const r = matchRows([row("Auro Chocolate Cafe Makati")], clients, NOW);
    // tokens: auro chocolate cafe makati vs auro chocolate cafe -> dice 0.857, 3 shared
    expect(r[0]!.match).toBe("possible");
    expect(r[0]!.default_selected).toBe(false);
    expect(r[0]!.flags.map((f) => f.code)).toContain("possible_match");
  });
  it("never guesses on one shared word or when two names are equally close", () => {
    const one = matchRows([row("Carl Bakery")], clients, NOW)[0]!;
    expect(one.match).toBe("none");
    expect(one.suggestions).toContain("Carl Trading");
    const tie = matchRows([row("River Garden Foods Co")], clients, NOW);
    // "Co" is a legal ending: exact on "river garden foods", shown as the 2 client groups with that name
    expect(tie.every((x) => x.match === "exact")).toBe(true);
    const unknown = matchRows([row("Totally Unknown Restaurant")], clients, NOW)[0]!;
    expect(unknown).toMatchObject({ match: "none", status: "no_match", selectable: false });
  });
  it("refuses names that are too short to search safely", () => {
    const r = matchRows([row("ABC")], clients, NOW)[0]!;
    expect(r.status).toBe("no_match");
    expect(r.flags[0]!.code).toBe("short_name");
  });
  it("a customer name that matches several client groups shows each one and marks the same-name ones", () => {
    const r = matchRows([row("River Garden Foods")], clients, NOW);
    expect(r).toHaveLength(2);
    expect(r[0]!.flags.map((f) => f.code)).toContain("shared_customer");
    // the n8n command tells "River Garden Foods" and "River Garden Foods Corp" apart, so each can be contacted
    expect(r.every((x) => x.selectable)).toBe(true);
    const twins = [client({ client_id: "T1___a" }), client({ client_id: "T2___b" })]; // same client_name
    const t = matchRows([row("ACME Trading")], twins, NOW);
    expect(t.every((x) => x.status === "blocked")).toBe(true);
    expect(t[0]!.flags.map((f) => f.code)).toContain("ambiguous_name");
  });
  it("summarises the review", () => {
    const r = matchRows([row("Carl Trading"), row("Nope Nope Nope")], clients, NOW);
    expect(summarize(r)).toMatchObject({ needs_approval: 1, no_match: 1, default_selected: 1 });
  });
});

describe("names the n8n contact command cannot take", () => {
  it("keeps legal endings together but refuses names that would be cut", () => {
    expect(survivesNameSplit("Aji-No-Chinmi Co., Inc.")).toBe(true);
    expect(survivesNameSplit("Hann Philippines, Inc.")).toBe(true);
    expect(survivesNameSplit("Smith, John Foods")).toBe(false);
    expect(survivesNameSplit("Alpha; Beta")).toBe(false);
  });
  it("blocks such a client", () => {
    const a = assessClient(client({ client_name: "Smith, John Foods" }), {
      match: "exact",
      sameNameCount: 1,
      groupSize: 1,
      fileAmount: null,
      now: NOW,
    });
    expect(a.selectable).toBe(false);
    expect(a.flags.map((f) => f.code)).toContain("unsendable_name");
  });
  it("a client found through two similar names is still ONE candidate (no false ambiguity)", () => {
    const c = client({
      client_id: "AURO___a",
      client_name: "Auro Chocolate Cafe Inc.",
      parent_name: "",
      invoices: [
        {
          branch: "Auro Chocolate Cafe Inc. (Makati) - Commissary",
          number: "A1",
          due: "2026-10-01",
          balance: 10,
          status: "OVERDUE",
          counter: "",
        },
      ],
    });
    expect(matchRows([row("Auro Chocolate Cafe Makati")], [c], NOW)[0]!.match).toBe("possible");
  });
});

describe("assessClient (same rules the server enforces before sending)", () => {
  const ok = {
    match: "exact" as const,
    sameNameCount: 1,
    groupSize: 1,
    fileAmount: null,
    now: NOW,
  };
  const codes = (c: MatchClient, o = {}) =>
    assessClient(c, { ...ok, ...o }).flags.map((f) => f.code);

  it("a normal unapproved client needs approval and is pre-selected", () => {
    const a = assessClient(client(), ok);
    expect(a).toMatchObject({ status: "needs_approval", selectable: true, defaultSelected: true });
  });
  it("an approved client is ready", () => {
    expect(assessClient(client({ approved: true }), ok).status).toBe("ready");
  });
  it.each([
    ["internal account", { internal_account: true }, "internal"],
    ["owner not in Sales Team", { sales_team: false }, "not_sales_team"],
    ["no overdue balance", { overdue: 0 }, "no_overdue"],
    ["active promise", { promise_until: "2026-11-20T00:00:00Z" }, "promise"],
    ["no email and no phone", { email: "", phone: "" }, "no_contact"],
    [
      "already texted AND called",
      { text_this_cycle: true, call_this_cycle: true },
      "already_contacted",
    ],
  ])("blocks: %s", (_n, o, code) => {
    const a = assessClient(client(o as Partial<MatchClient>), ok);
    expect(a.status).toBe("blocked");
    expect(a.selectable).toBe(false);
    expect(a.flags.map((f) => f.code)).toContain(code);
  });
  it("an expired promise does not block", () => {
    expect(assessClient(client({ promise_until: "2026-11-01T00:00:00Z" }), ok).selectable).toBe(
      true,
    );
  });
  it("warns (selectable, not pre-selected) for hand-off and 5+ branches", () => {
    for (const o of [
      { ar_handoff_until: "2026-11-17T00:00:00Z" },
      { multibranch: true, branch_count: 7 },
    ]) {
      const a = assessClient(client(o), ok);
      expect(a.selectable).toBe(true);
      expect(a.defaultSelected).toBe(false);
    }
  });
  it("only one of text / call done is information, not a block", () => {
    expect(codes(client({ text_this_cycle: true }))).toContain("partly_contacted");
    expect(assessClient(client({ call_this_cycle: true }), ok).selectable).toBe(true);
  });
  it("shows when the sheet amount differs from Zoho", () => {
    expect(codes(client(), { fileAmount: 5000 })).toContain("amount_differs");
    expect(codes(client(), { fileAmount: 1000.4 })).not.toContain("amount_differs");
  });
});

describe("outsideOfficeHours (Manila)", () => {
  // 2026-11-12 is a Thursday. Manila = UTC+8.
  it("is false during Monday-Friday 9-18 and true otherwise", () => {
    expect(outsideOfficeHours(Date.UTC(2026, 10, 12, 2, 0))).toBe(false); // Thu 10:00
    expect(outsideOfficeHours(Date.UTC(2026, 10, 12, 9, 59))).toBe(false); // Thu 17:59
    expect(outsideOfficeHours(Date.UTC(2026, 10, 12, 10, 0))).toBe(true); // Thu 18:00
    expect(outsideOfficeHours(Date.UTC(2026, 10, 12, 0, 59))).toBe(true); // Thu 08:59
    expect(outsideOfficeHours(Date.UTC(2026, 10, 14, 3, 0))).toBe(true); // Sat 11:00
    expect(outsideOfficeHours(Date.UTC(2026, 10, 15, 3, 0))).toBe(true); // Sun 11:00
    expect(outsideOfficeHours(Date.UTC(2026, 10, 13, 8, 0))).toBe(false); // Fri 16:00
  });
});
