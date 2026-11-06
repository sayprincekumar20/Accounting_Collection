// Open invoices of one client (Contact Approvals, 5+ branch accounts, Other Accounts): the same table everywhere.
export interface InvoiceRow {
  branch: string;
  number: string;
  date: string;
  due: string;
  amount: number;
  balance: number;
  status: string;
  po: string;
}

const peso = (v: number) =>
  "PHP " +
  Number(v || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (v: string) =>
  v
    ? new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "";

/** 'Show N invoice(s)' / 'Hide invoices' toggle. */
export function InvoiceToggle({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold hover:bg-muted"
    >
      {open ? "Hide invoices" : `Show ${count} invoice(s)`}
    </button>
  );
}

export function InvoiceTable({ invoices }: { invoices: InvoiceRow[] }) {
  if (!invoices.length)
    return <p className="py-1 text-xs text-muted-foreground">No open invoices.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-3">Invoice</th>
            <th className="py-1 pr-3">Branch</th>
            <th className="py-1 pr-3">Date</th>
            <th className="py-1 pr-3">Due date</th>
            <th className="py-1 pr-3 text-right">Amount</th>
            <th className="py-1 pr-3 text-right">Balance</th>
            <th className="py-1 pr-3">Status</th>
            <th className="py-1">PO</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((v, k) => (
            <tr key={k} className="border-t border-border">
              <td className="py-1 pr-3 font-semibold">{v.number}</td>
              <td className="py-1 pr-3">{v.branch}</td>
              <td className="py-1 pr-3">{day(v.date)}</td>
              <td className="py-1 pr-3">{day(v.due)}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{peso(v.amount)}</td>
              <td className="py-1 pr-3 text-right tabular-nums">{peso(v.balance)}</td>
              <td
                className={`py-1 pr-3 font-semibold ${v.status === "OVERDUE" ? "text-destructive" : ""}`}
              >
                {v.status || "–"}
              </td>
              <td className="py-1">{v.po || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
