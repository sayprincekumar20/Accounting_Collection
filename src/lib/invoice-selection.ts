// Invoice selection (Contact Approvals). n8n keeps a client's UNTICKED invoices out of branches_data (in
// excluded_invoices_data) so everything it sends uses only the ticked ones. The dashboard shows the REAL full
// balance: the excluded invoices are put back here, marked `excluded: true`, and `selection` tells what is sent.
// Same data shape as n8n's selRestore (workflows 28 and 00).
type Row = Record<string, unknown>;
type Inv = Record<string, unknown>;
const parse = <T>(v: unknown, d: T): T => {
  try {
    const x = JSON.parse(String(v ?? "")) as T | null;
    return x == null ? d : x;
  } catch {
    return d;
  }
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Selection {
  /** Unticked invoice numbers (not sent this cycle). */
  excluded: string[];
  /** What the automation sends: the ticked invoices only. */
  sent_amount: number;
  sent_overdue: number;
  selected_count: number;
  total_count: number;
}

/** The client row with ALL invoices (unticked ones marked) and its `selection`, or the row unchanged. */
export function withSelectionRestored<T extends Row>(row: T): T {
  const excluded = parse<{ branch?: Row; invoice?: Inv }[]>(
    row["excluded_invoices_data"],
    [],
  ).filter((e) => e && e.invoice);
  if (!excluded.length) return row;
  const branches: (Row & { _inv: Inv[] })[] = parse<Row[]>(row["branches_data"], []).map((b) => ({
    ...b,
    _inv: parse<Inv[]>(b["invoice_details"], []),
  }));
  let sentCount = 0;
  for (const b of branches) sentCount += b._inv.length;
  for (const e of excluded) {
    const name = String((e.branch ?? {})["branch_name"] ?? "");
    let b = branches.find((x) => String(x["branch_name"] ?? "") === name);
    if (!b) {
      b = { ...(e.branch ?? {}), _inv: [] as Inv[] };
      branches.push(b);
    }
    const num = String(e.invoice!["invoice_number"] ?? "");
    if (!b._inv.some((i) => String(i["invoice_number"] ?? "") === num))
      b._inv.push({ ...e.invoice!, excluded: true });
  }
  let od = 0;
  let cur = 0;
  const full = branches.map(({ _inv, ...b }) => {
    let bo = 0;
    let bc = 0;
    for (const i of _inv) {
      const bal = Number(i["balance"] || 0);
      if (String(i["status"] ?? "").toUpperCase() === "OVERDUE") bo += bal;
      else bc += bal;
    }
    od += bo;
    cur += bc;
    return {
      ...b,
      invoice_details: JSON.stringify(_inv),
      invoice_numbers: _inv
        .map((i) => String(i["invoice_number"] ?? ""))
        .filter(Boolean)
        .join(", "),
      overdue_total: r2(bo),
      current_total: r2(bc),
      collection_amount: r2(bo + bc),
    };
  });
  const selection: Selection = {
    excluded: excluded.map((e) => String(e.invoice!["invoice_number"] ?? "")).filter(Boolean),
    sent_amount: Number(row["collection_amount"] || 0),
    sent_overdue: Number(row["overdue_total"] || 0),
    selected_count: sentCount,
    total_count: sentCount + excluded.length,
  };
  return {
    ...row,
    branches_data: JSON.stringify(full),
    collection_amount: r2(od + cur),
    overdue_total: r2(od),
    current_total: r2(cur),
    invoice_numbers: full
      .map((b) => b.invoice_numbers)
      .filter(Boolean)
      .join(", "),
    selection,
  };
}

/** Amounts and invoice statuses of what is SENT (ticked invoices only), from a restored row. */
export function sentView(row: Row): {
  overdue: number;
  current: number;
  total: number;
  statuses: string[];
} {
  let overdue = 0;
  let current = 0;
  const statuses: string[] = [];
  for (const b of parse<Row[]>(row["branches_data"], []))
    for (const i of parse<Inv[]>(b["invoice_details"], [])) {
      if (i["excluded"] === true) continue;
      const bal = Number(i["balance"] || 0);
      if (!(bal > 0)) continue;
      const st = String(i["status"] ?? "").toUpperCase();
      statuses.push(st);
      if (st === "OVERDUE") overdue += bal;
      else current += bal;
    }
  return { overdue: r2(overdue), current: r2(current), total: r2(overdue + current), statuses };
}
