// Overdue status AS OF TODAY (Manila), not as of the last Zoho refresh. n8n sets each invoice's status
// when it refreshes a client (the full refresh runs on Wednesdays), so an invoice due on Thursday stayed
// "CURRENT" until the next refresh and every page understated the overdue amount (Nov 26: 12 invoices,
// PHP 1.68M). Same rule as the statement PDF: OVERDUE once the due date has passed; never back to current.
// Only overdue_total / current_total and the invoice statuses change; collection_amount (what is owed) never.
type Row = Record<string, unknown>;

export function manilaToday(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The client row with statuses and overdue/current totals as of `today` (YYYY-MM-DD, Manila). */
export function withLiveStatus<T extends Row>(row: T, today: string): T {
  const raw = row["branches_data"];
  if (typeof raw !== "string" || !raw.includes("CURRENT")) return row;
  let branches: Row[];
  try {
    branches = JSON.parse(raw) as Row[];
  } catch {
    return row;
  }
  let changed = false;
  let od = 0;
  let cur = 0;
  for (const b of branches) {
    let inv: Row[];
    try {
      inv = JSON.parse(String(b["invoice_details"] ?? "[]")) as Row[];
    } catch {
      od += Number(b["overdue_total"] || 0);
      cur += Number(b["current_total"] || 0);
      continue;
    }
    let bOd = 0;
    let bCur = 0;
    let bChanged = false;
    for (const i of inv) {
      const due = String(i["rule_due_date"] || i["due_date"] || "").slice(0, 10);
      if (
        String(i["status"] ?? "").toUpperCase() === "CURRENT" &&
        /^\d{4}-\d{2}-\d{2}$/.test(due) &&
        due < today
      ) {
        i["status"] = "OVERDUE";
        bChanged = true;
      }
      const bal = Number(i["balance"] || 0);
      if (String(i["status"] ?? "").toUpperCase() === "OVERDUE") bOd += bal;
      else bCur += bal;
    }
    if (bChanged) {
      changed = true;
      b["invoice_details"] = JSON.stringify(inv);
      b["overdue_total"] = r2(bOd);
      b["current_total"] = r2(bCur);
      od += bOd;
      cur += bCur;
    } else {
      od += Number(b["overdue_total"] || 0);
      cur += Number(b["current_total"] || 0);
    }
  }
  if (!changed) return row;
  return {
    ...row,
    branches_data: JSON.stringify(branches),
    overdue_total: r2(od),
    current_total: r2(cur),
  };
}
