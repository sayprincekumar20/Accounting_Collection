// AI assistant contact lists: reading a sheet, matching its customer names to our clients and deciding, per
// client, whether it can be contacted. Pure functions (no network) shared by the browser and the server, so the
// rules shown in the review table are exactly the rules enforced again on the server before anything is sent.

// ---------------------------------------------------------------------------------------------- file rows
export interface FileRow {
  /** 1-based row number in the sheet (for messages). */
  row: number;
  name: string;
  owner: string;
  amount: number | null;
  remarks: string;
}

const cell = (v: unknown) => (v == null ? "" : String(v).trim());
const isCustomerHeader = (v: unknown) => /^\s*customer(\s*name)?\s*$/i.test(cell(v));
const TOTAL_ROW = /^(sub\s*total|total|grand\s*total)$/i;

function toAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = cell(v).replace(/[^0-9.-]/g, "");
  if (!t || t === "-" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Customer rows of one sheet. The header row (a cell that says "Customer" / "Customer Name") may sit below
 * title rows; the owner, amount and remarks columns are found by their headers. Empty rows, total rows and
 * repeated names are dropped.
 */
export function parseSheetRows(data: unknown[][]): { rows: FileRow[]; note: string } {
  let hi = -1;
  let ci = -1;
  for (let r = 0; r < Math.min(data.length, 30) && ci < 0; r++) {
    const c = (data[r] ?? []).findIndex(isCustomerHeader);
    if (c >= 0) {
      hi = r;
      ci = c;
    }
  }
  if (ci < 0)
    return { rows: [], note: 'No "Customer" column found. The column header must say Customer.' };
  const header = (data[hi] ?? []).map((h) => cell(h).toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const oi = col(/owner|handler|assigned|ar\b/);
  const ai = col(/overdue|balance|amount|total/);
  const ri = col(/remark|note/);
  const seen = new Set<string>();
  const rows: FileRow[] = [];
  let dupes = 0;
  for (let r = hi + 1; r < data.length; r++) {
    const line = data[r] ?? [];
    const name = cell(line[ci]);
    if (!name || TOTAL_ROW.test(name)) continue;
    const key = normalizeName(name);
    if (!key) continue;
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    rows.push({
      row: r + 1,
      name,
      owner: oi >= 0 ? cell(line[oi]) : "",
      amount: ai >= 0 ? toAmount(line[ai]) : null,
      remarks: ri >= 0 ? cell(line[ri]) : "",
    });
  }
  return {
    rows,
    note: dupes ? `${dupes} repeated name${dupes === 1 ? "" : "s"} in this sheet ignored.` : "",
  };
}

// ---------------------------------------------------------------------------------------------- names
const LEGAL = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "llc",
  "opc",
  "the",
]);

export function nameTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !LEGAL.has(t));
}

/** Canonical form of a company name: case, punctuation and legal endings (Inc., Corp., Co., Ltd.) ignored. */
export const normalizeName = (raw: string) => nameTokens(raw).join(" ");

const alnum = (s: string) => s.replace(/[^a-z0-9]/gi, "").length;

/** How the n8n contact command compares names: letters and digits only, lower case (legal endings kept). */
export const n8nNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const N8N_SUFFIX =
  /^(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llc\.?|l\.l\.c\.?|opc\.?)$/i;
/**
 * The contact command splits a typed list on commas, semicolons and line breaks (keeping legal endings such as
 * ", Inc." with their company). A client name that would be cut into pieces cannot be sent by name.
 */
export function survivesNameSplit(name: string): boolean {
  const parts = name
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const part of parts) {
    if (N8N_SUFFIX.test(part) && merged.length) merged[merged.length - 1] += ", " + part;
    else merged.push(part);
  }
  return merged.length === 1;
}

/** Dice similarity of two token lists (0..1) and the number of shared tokens. */
export function similarity(a: string[], b: string[]): { score: number; shared: number } {
  if (!a.length || !b.length) return { score: 0, shared: 0 };
  const rest = [...b];
  let shared = 0;
  for (const t of a) {
    const i = rest.indexOf(t);
    if (i >= 0) {
      shared++;
      rest.splice(i, 1);
    }
  }
  return { score: (2 * shared) / (a.length + b.length), shared };
}

// ---------------------------------------------------------------------------------------------- clients
export interface ReviewInvoice {
  branch: string;
  number: string;
  due: string;
  balance: number;
  status: string;
  counter: string;
  days_overdue: number;
}

/** The fields of a Contact Approvals item that matching and eligibility need. */
export interface MatchClient {
  client_id: string;
  client_name: string;
  parent_name: string;
  contact_person: string;
  email: string;
  phone: string;
  ar_owner: string;
  sales_person: string;
  collection_schedule: string;
  overdue: number;
  current: number;
  total: number;
  branch_count: number;
  multibranch: boolean;
  approved: boolean;
  allow_multibranch: boolean;
  text_this_cycle: boolean;
  call_this_cycle: boolean;
  promise_until: string;
  ar_handoff_until: string;
  sales_team: boolean | null;
  internal_account: boolean;
  invoices: {
    branch: string;
    number: string;
    due: string;
    balance: number;
    status: string;
    counter: string;
  }[];
}

export type FlagCode =
  | "not_sales_team"
  | "internal"
  | "no_overdue"
  | "promise"
  | "no_contact"
  | "short_name"
  | "ambiguous_name"
  | "unsendable_name"
  | "already_contacted"
  | "ar_handoff"
  | "multibranch"
  | "possible_match"
  | "shared_customer"
  | "amount_differs"
  | "partly_contacted"
  | "approved";
/** block = cannot be contacted, warn = selectable but not pre-selected, info = just shown. */
export type FlagLevel = "block" | "warn" | "info";
export interface Flag {
  code: FlagCode;
  level: FlagLevel;
  label: string;
}

const ms = (v: string) => new Date(v).getTime() || 0;
const day = (v: string) => v.slice(0, 10);
const peso = (n: number) =>
  "PHP " +
  (Number.isFinite(n) ? n : 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export interface AssessInput {
  match: "exact" | "possible";
  /** Number of client rows that share this exact client name (n8n finds clients by name). */
  sameNameCount: number;
  /** Number of client rows this one customer name in the file matched. */
  groupSize: number;
  fileAmount: number | null;
  now?: number;
}

export interface Assessment {
  status: "ready" | "needs_approval" | "blocked";
  flags: Flag[];
  selectable: boolean;
  defaultSelected: boolean;
}

/** Can this client be contacted now, and what should the person reviewing know about it? */
export function assessClient(c: MatchClient, a: AssessInput): Assessment {
  const now = a.now ?? Date.now();
  const flags: Flag[] = [];
  const add = (code: FlagCode, level: FlagLevel, label: string) =>
    flags.push({ code, level, label });

  if (c.internal_account) add("internal", "block", "Internal Rare account (never contacted)");
  if (c.sales_team === false)
    add("not_sales_team", "block", "Account owner is not in the Sales Team");
  if (!(c.overdue > 0)) add("no_overdue", "block", "No overdue balance");
  if (ms(c.promise_until) > now)
    add("promise", "block", `Payment promise until ${day(c.promise_until)}`);
  if (!c.email.trim() && !c.phone.trim())
    add("no_contact", "block", "No email or phone number on file");
  if (!survivesNameSplit(c.client_name))
    add(
      "unsendable_name",
      "block",
      "The client name contains a comma or semicolon: contact it from its own page",
    );
  if (a.sameNameCount > 1)
    add(
      "ambiguous_name",
      "block",
      "Several clients share this exact name: contact it from its own page",
    );
  if (c.text_this_cycle && c.call_this_cycle)
    add(
      "already_contacted",
      "block",
      'Already texted and called this cycle (ask the assistant to "force" a repeat)',
    );
  else if (c.text_this_cycle)
    add("partly_contacted", "info", "Text already sent this cycle; the call will still be placed");
  else if (c.call_this_cycle)
    add("partly_contacted", "info", "Call already made this cycle; the text will still be sent");

  if (ms(c.ar_handoff_until) > now)
    add("ar_handoff", "warn", `AR has taken over this client until ${day(c.ar_handoff_until)}`);
  if (c.multibranch)
    add("multibranch", "warn", `${c.branch_count} branches: AR contacts these on request`);
  if (a.match === "possible")
    add("possible_match", "warn", "Name is similar, not identical: check before selecting");
  if (a.groupSize > 1)
    add("shared_customer", "info", `One of ${a.groupSize} client groups under this customer name`);
  if (a.fileAmount != null && Math.abs(a.fileAmount - c.overdue) > 1)
    add(
      "amount_differs",
      "info",
      `Sheet says ${peso(a.fileAmount)}, Zoho says ${peso(c.overdue)} overdue`,
    );
  if (c.approved) add("approved", "info", "Approved this cycle");

  const blocked = flags.some((f) => f.level === "block");
  const warned = flags.some((f) => f.level === "warn");
  return {
    status: blocked ? "blocked" : c.approved ? "ready" : "needs_approval",
    flags,
    selectable: !blocked,
    defaultSelected: !blocked && !warned && a.match === "exact",
  };
}

// ---------------------------------------------------------------------------------------------- matching
export interface ReviewRow {
  id: string;
  file: FileRow;
  match: "exact" | "possible" | "none";
  suggestions: string[];
  client: ReviewClientOut | null;
  status: "ready" | "needs_approval" | "blocked" | "no_match";
  flags: Flag[];
  selectable: boolean;
  default_selected: boolean;
}
export interface ReviewClientOut extends Omit<MatchClient, "invoices"> {
  invoices: ReviewInvoice[];
}

const NOW_DAYS = (due: string, now: number) => {
  const d = ms(due);
  return d && d < now ? Math.floor((now - d) / 86400000) : 0;
};

export function toReviewClient(c: MatchClient, now = Date.now()): ReviewClientOut {
  return {
    ...c,
    invoices: c.invoices.map((i) => ({
      branch: i.branch,
      number: i.number,
      due: day(i.due),
      balance: i.balance,
      status: i.status,
      counter: i.counter,
      days_overdue: NOW_DAYS(i.due, now),
    })),
  };
}

interface Index {
  /** normalized name -> client indexes, per kind of name */
  byKey: Map<string, Set<number>>;
  keys: { key: string; tokens: string[]; display: string }[];
  sameName: Map<string, number>;
}

export function buildIndex(clients: MatchClient[]): Index {
  const byKey = new Map<string, Set<number>>();
  const display = new Map<string, string>();
  const put = (name: string, i: number) => {
    const k = normalizeName(name);
    if (!k) return;
    (byKey.get(k) ?? byKey.set(k, new Set()).get(k)!).add(i);
    if (!display.has(k)) display.set(k, name.trim());
  };
  clients.forEach((c, i) => {
    put(c.client_name, i);
    if (c.parent_name) put(c.parent_name, i);
    for (const b of new Set(c.invoices.map((x) => x.branch).filter(Boolean))) put(b, i);
  });
  const sameName = new Map<string, number>();
  for (const c of clients) {
    const k = n8nNorm(c.client_name);
    sameName.set(k, (sameName.get(k) ?? 0) + 1);
  }
  return {
    byKey,
    keys: [...byKey.keys()].map((k) => ({
      key: k,
      tokens: k.split(" "),
      display: display.get(k)!,
    })),
    sameName,
  };
}

/** Match every customer name of the sheet to our clients (exact, then a careful similar-name match). */
export function matchRows(rows: FileRow[], clients: MatchClient[], now = Date.now()): ReviewRow[] {
  const idx = buildIndex(clients);
  const out: ReviewRow[] = [];
  for (const f of rows) {
    const key = normalizeName(f.name);
    const tokens = key ? key.split(" ") : [];
    let match: "exact" | "possible" | "none" = "none";
    let hits: number[] = [];
    let suggestions: string[] = [];

    if (alnum(f.name) < 4 || !key) {
      out.push(noMatch(f, [], "Name too short to match safely"));
      continue;
    }
    const exact = idx.byKey.get(key);
    if (exact?.size) {
      match = "exact";
      hits = [...exact];
    } else {
      const scored = idx.keys
        .map((k) => ({ k, ...similarity(tokens, k.tokens) }))
        .filter((x) => x.score >= 0.5)
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const sig = (k: string) => [...idx.byKey.get(k)!].sort((x, y) => x - y).join(",");
      // Names that lead to the same client(s) are not competing candidates.
      const rival = best ? scored.find((x) => sig(x.k.key) !== sig(best.k.key)) : undefined;
      if (
        best &&
        best.score >= 0.8 &&
        best.shared >= 2 &&
        (!rival || best.score - rival.score >= 0.1)
      ) {
        match = "possible";
        hits = [...idx.byKey.get(best.k.key)!];
      } else suggestions = scored.slice(0, 3).map((x) => x.k.display);
    }
    if (!hits.length) {
      out.push(noMatch(f, suggestions));
      continue;
    }
    const group = [...new Set(hits)];
    for (const i of group) {
      const c = clients[i]!;
      const a = assessClient(c, {
        match: match === "exact" ? "exact" : "possible",
        sameNameCount: idx.sameName.get(n8nNorm(c.client_name)) ?? 1,
        groupSize: group.length,
        fileAmount: f.amount,
        now,
      });
      out.push({
        id: `${f.row}:${c.client_id}`,
        file: f,
        match,
        suggestions: [],
        client: toReviewClient(c, now),
        status: a.status,
        flags: a.flags,
        selectable: a.selectable,
        default_selected: a.defaultSelected,
      });
    }
  }
  return out;
}

function noMatch(f: FileRow, suggestions: string[], note?: string): ReviewRow {
  return {
    id: `${f.row}:none`,
    file: f,
    match: "none",
    suggestions,
    client: null,
    status: "no_match",
    flags: note ? [{ code: "short_name", level: "block", label: note }] : [],
    selectable: false,
    default_selected: false,
  };
}

export function summarize(rows: ReviewRow[]) {
  const c = { ready: 0, needs_approval: 0, blocked: 0, no_match: 0, default_selected: 0 };
  for (const r of rows) {
    c[r.status]++;
    if (r.default_selected) c.default_selected++;
  }
  return c;
}

/** Result of "Approve + contact" (returned by /api/assistant/contact-list). */
export interface ContactListResult {
  ok: boolean;
  accepted: { client_id: string; client_name: string }[];
  approved: number;
  rejected: { client_id: string; name: string; reason: string }[];
  reply: string;
  error?: string;
}

/** Text the assistant keeps in the conversation, so follow-up questions about the list can be answered. */
export function reviewSummaryText(sheet: string, rows: ReviewRow[]): string {
  const s = summarize(rows);
  const customers = new Set(rows.map((r) => r.file.row)).size;
  const parts = [
    `I read sheet "${sheet}": ${customers} customer${customers === 1 ? "" : "s"}.`,
    `${s.ready} ready, ${s.needs_approval} need approval, ${s.blocked} blocked, ${s.no_match} not found.`,
  ];
  const blocked = rows
    .filter((r) => r.status === "blocked")
    .slice(0, 12)
    .map(
      (r) =>
        `${r.client?.client_name ?? r.file.name} (${r.flags
          .filter((f) => f.level === "block")
          .map((f) => f.label)
          .join("; ")})`,
    );
  if (blocked.length) parts.push("Blocked: " + blocked.join(" · "));
  const none = rows
    .filter((r) => r.status === "no_match")
    .slice(0, 12)
    .map((r) => r.file.name + (r.suggestions.length ? ` (did you mean ${r.suggestions[0]}?)` : ""));
  if (none.length) parts.push("Not found: " + none.join(" · "));
  parts.push(
    'Tick the clients you want below, then press "Approve + contact". Nothing is sent before you confirm.',
  );
  return parts.join("\n\n");
}

/** Outside Monday to Friday, 9 AM to 6 PM Manila time (a manual contact ignores office hours, so people are warned). */
export function outsideOfficeHours(now = Date.now()): boolean {
  const m = new Date(now + 8 * 3600000);
  const d = m.getUTCDay();
  const h = m.getUTCHours();
  return d === 0 || d === 6 || h < 9 || h >= 18;
}

// ---------------------------------------------------------------------------------------------- safe reading
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const yes = (v: unknown) => v === true || v === "true";

function cleanClient(c: unknown): ReviewClientOut | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const id = str(o["client_id"]);
  if (!id) return null;
  const inv = Array.isArray(o["invoices"]) ? o["invoices"] : [];
  return {
    client_id: id,
    client_name: str(o["client_name"]),
    parent_name: str(o["parent_name"]),
    contact_person: str(o["contact_person"]),
    email: str(o["email"]),
    phone: str(o["phone"]),
    ar_owner: str(o["ar_owner"]),
    sales_person: str(o["sales_person"]),
    collection_schedule: str(o["collection_schedule"]),
    overdue: num(o["overdue"]),
    current: num(o["current"]),
    total: num(o["total"]),
    branch_count: num(o["branch_count"]),
    multibranch: yes(o["multibranch"]),
    approved: yes(o["approved"]),
    allow_multibranch: yes(o["allow_multibranch"]),
    text_this_cycle: yes(o["text_this_cycle"]),
    call_this_cycle: yes(o["call_this_cycle"]),
    promise_until: str(o["promise_until"]),
    ar_handoff_until: str(o["ar_handoff_until"]),
    sales_team: yes(o["sales_team"]) ? true : o["sales_team"] === false ? false : null,
    internal_account: yes(o["internal_account"]),
    invoices: inv
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const i = x as Record<string, unknown>;
        return {
          branch: str(i["branch"]),
          number: str(i["number"]),
          due: str(i["due"]),
          balance: num(i["balance"]),
          status: str(i["status"]),
          counter: str(i["counter"]),
          days_overdue: num(i["days_overdue"]),
        };
      }),
  };
}

const STATUSES = ["ready", "needs_approval", "blocked", "no_match"] as const;
const MATCHES = ["exact", "possible", "none"] as const;
const LEVELS = ["block", "warn", "info"] as const;

/**
 * The browser does not trust the exact shape of the server's answer: every row is rebuilt with safe types
 * (text, numbers, arrays), so one odd value can never break the review screen.
 */
export function normalizeReviewRows(input: unknown): ReviewRow[] {
  if (!Array.isArray(input)) return [];
  const out: ReviewRow[] = [];
  const seen = new Set<string>();
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const f = (o["file"] && typeof o["file"] === "object" ? o["file"] : {}) as Record<
      string,
      unknown
    >;
    const name = str(f["name"]).trim();
    if (!name) continue;
    const client = cleanClient(o["client"]);
    const status = STATUSES.find((s) => s === o["status"]) ?? (client ? "blocked" : "no_match");
    let id = str(o["id"]) || `${num(f["row"])}:${client?.client_id ?? "none"}`;
    while (seen.has(id)) id += "#";
    seen.add(id);
    out.push({
      id,
      file: {
        row: num(f["row"]),
        name,
        owner: str(f["owner"]),
        amount:
          typeof f["amount"] === "number" && Number.isFinite(f["amount"]) ? f["amount"] : null,
        remarks: str(f["remarks"]),
      },
      match: MATCHES.find((m) => m === o["match"]) ?? "none",
      suggestions: (Array.isArray(o["suggestions"]) ? o["suggestions"] : [])
        .map(str)
        .filter(Boolean),
      client,
      status: client ? status : "no_match",
      flags: (Array.isArray(o["flags"]) ? o["flags"] : [])
        .filter((x) => x && typeof x === "object" && str((x as Record<string, unknown>)["label"]))
        .map((x) => {
          const fl = x as Record<string, unknown>;
          return {
            code: str(fl["code"]) as FlagCode,
            level: LEVELS.find((l) => l === fl["level"]) ?? "info",
            label: str(fl["label"]),
          };
        }),
      selectable: client ? yes(o["selectable"]) : false,
      default_selected: client ? yes(o["default_selected"]) : false,
    });
  }
  return out;
}
