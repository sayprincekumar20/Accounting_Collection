import { describe, expect, it } from "vitest";
import { parseCsv, sheetsFromData } from "../src/lib/assistant/list-file";

describe("parseCsv", () => {
  it("reads quotes, commas inside quotes, doubled quotes and Windows line breaks", () => {
    const rows = parseCsv(
      '\uFEFFCustomer,Amount\r\n"Aji-No-Chinmi Co., Inc.",1350\r\n"Say ""Hi"" Foods",20\r\n',
    );
    expect(rows).toEqual([
      ["Customer", "Amount"],
      ["Aji-No-Chinmi Co., Inc.", "1350"],
      ['Say "Hi" Foods', "20"],
    ]);
  });
  it("detects a semicolon-separated file", () => {
    expect(parseCsv("Customer;Total Overdue Balance\nAlpha;100")).toEqual([
      ["Customer", "Total Overdue Balance"],
      ["Alpha", "100"],
    ]);
  });
  it("feeds the same sheet reader as Excel", () => {
    const [s] = sheetsFromData([
      { sheet: "CSV", data: parseCsv('Customer,Total Overdue Balance\nAlpha Foods,"1,200.50"') },
    ]);
    expect(s!.rows).toHaveLength(1);
    expect(s!.rows[0]).toMatchObject({ name: "Alpha Foods", amount: 1200.5 });
  });
});

import { readFileSync } from "node:fs";
import { parseListFile } from "../src/lib/assistant/list-file";

describe("parseListFile (Excel, same layout as the AR follow-up workbook)", () => {
  const file = (name: string, buf: BlobPart) => new File([buf], name);
  it("reads every sheet: title row, header on row 3, trailing blank rows ignored", async () => {
    const f = await parseListFile(
      file("lists.xlsx", readFileSync(new URL("./fixtures/lists.xlsx", import.meta.url))),
    );
    expect(f.sheets.map((s) => [s.name, s.rows.length])).toEqual([
      ["ALL", 3],
      ["DAVE", 2],
      ["NOTES", 0],
    ]);
    expect(f.sheets[0]!.rows[1]).toMatchObject({
      row: 5,
      name: "Demo Meats Corp",
      owner: "Dave",
      amount: 250,
      remarks: "call first",
    });
    expect(f.sheets[2]!.note).toContain("Customer");
  });
  it("reads a CSV file", async () => {
    const f = await parseListFile(file("l.csv", "Customer\nAlpha Foods\nBeta Meats"));
    expect(f.sheets[0]!.rows.map((r) => r.name)).toEqual(["Alpha Foods", "Beta Meats"]);
  });
  it("refuses other file types with a clear message", async () => {
    await expect(parseListFile(file("l.pdf", "x"))).rejects.toThrow("Excel (.xlsx) or CSV");
  });
});

import { dropHiddenSheets, hiddenSheetNames } from "../src/lib/assistant/list-file";

describe("hidden sheets are left out", () => {
  it("reads the hidden / very hidden flags from workbook.xml (names unescaped)", () => {
    const xml =
      '<sheets><sheet name="ALL" sheetId="1" r:id="rId1"/><sheet name="JOANNA" sheetId="3" state="hidden" r:id="rId2"/>' +
      '<sheet name="R&amp;D" sheetId="4" state="veryHidden" r:id="rId3"/></sheets>';
    expect(hiddenSheetNames(xml)).toEqual(["JOANNA", "R&D"]);
  });
  it("keeps the visible sheets; if every sheet is hidden, keeps them all", () => {
    const s = [
      { sheet: "ALL", data: [] },
      { sheet: "JOANNA", data: [] },
    ];
    expect(dropHiddenSheets(s, ["JOANNA"])).toEqual({ sheets: [s[0]], dropped: ["JOANNA"] });
    expect(dropHiddenSheets(s, ["ALL", "JOANNA"])).toEqual({ sheets: s, dropped: [] });
  });
});
