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
    return { id, name: file.name, sheets: sheetsFromData(sheets) };
  }
  throw new Error("Attach an Excel (.xlsx) or CSV file with a Customer column.");
}
