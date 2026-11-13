// AI assistant contact lists: reading an attached file in the browser (Excel or CSV) into sheets of customer rows.
import { parseSheetRows, type FileRow } from "./list-match";

export interface ParsedSheet {
  name: string;
  rows: FileRow[];
  note: string;
}
export interface ParsedFile {
  id: string;
  name: string;
  sheets: ParsedSheet[];
  /** Sheets hidden in Excel: not used (only the sheets the person can see count). */
  hiddenSheets?: string[];
}

const unXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Names of the sheets marked hidden (or "very hidden") in an xlsx workbook.xml. */
export function hiddenSheetNames(workbookXml: string): string[] {
  const out: string[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const state = tag.match(/\bstate="([^"]*)"/)?.[1] ?? "visible";
    const name = tag.match(/\bname="([^"]*)"/)?.[1];
    if (name != null && state !== "visible") out.push(unXml(name));
  }
  return out;
}

/** Keep only the sheets the person can see; if every sheet is hidden, keep them all. */
export function dropHiddenSheets(
  sheets: { sheet: string; data: unknown[][] }[],
  hidden: string[],
): { sheets: { sheet: string; data: unknown[][] }[]; dropped: string[] } {
  const h = new Set(hidden);
  const visible = sheets.filter((s) => !h.has(s.sheet));
  if (!visible.length) return { sheets, dropped: [] };
  return { sheets: visible, dropped: sheets.filter((s) => h.has(s.sheet)).map((s) => s.sheet) };
}

async function readHiddenSheets(file: File): Promise<string[]> {
  try {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => f.name === "xl/workbook.xml",
    });
    const xml = files["xl/workbook.xml"];
    return xml ? hiddenSheetNames(strFromU8(xml)) : [];
  } catch {
    return []; // cannot tell: use every sheet, as before
  }
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Minimal CSV reader: quotes, doubled quotes, CRLF / LF, BOM, comma or semicolon separated. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      out.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

export function sheetsFromData(sheets: { sheet: string; data: unknown[][] }[]): ParsedSheet[] {
  return sheets.map((s) => {
    const { rows, note } = parseSheetRows(s.data);
    return { name: s.sheet, rows, note };
  });
}

/** Read an attached .xlsx or .csv file. Throws an Error with a message that can be shown to the user. */
export async function parseListFile(file: File): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 5 MB.");
  const lower = file.name.toLowerCase();
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  if (lower.endsWith(".csv")) {
    const data = parseCsv(await file.text());
    return { id, name: file.name, sheets: sheetsFromData([{ sheet: "CSV", data }]) };
  }
  if (lower.endsWith(".xlsx")) {
    // The "web-worker" build reads in this page (no Web Worker, no Blob URL): the lists are small (5 MB limit) and
    // this keeps the reader independent of the browser's worker / security settings.
    const { default: readXlsxFile } = await import("read-excel-file/web-worker");
    let sheets: { sheet: string; data: unknown[][] }[];
    try {
      sheets = (await readXlsxFile(file)) as { sheet: string; data: unknown[][] }[];
    } catch {
      throw new Error("That Excel file could not be read. Try saving it again as .xlsx.");
    }
    const kept = dropHiddenSheets(sheets, await readHiddenSheets(file));
    return {
      id,
      name: file.name,
      sheets: sheetsFromData(kept.sheets),
      hiddenSheets: kept.dropped,
    };
  }
  throw new Error("Attach an Excel (.xlsx) or CSV file with a Customer column.");
}

/** Context for the chat AI (not shown on screen): the sheets of an attached file and their customer names. */
export function sheetsContextText(f: ParsedFile): string {
  const parts = f.sheets.map((s) =>
    s.rows.length
      ? `Sheet "${s.name}" (${s.rows.length} customers): ${s.rows.map((r) => r.name + (r.owner ? ` [${r.owner}]` : "")).join(", ")}`
      : `Sheet "${s.name}": no customer column`,
  );
  return (`Attached file "${f.name}":\n` + parts.join("\n")).slice(0, 5000);
}
