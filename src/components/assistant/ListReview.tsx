import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type {
  ContactListResult,
  Flag,
  ReviewClientOut,
  ReviewInvoice,
  ReviewRow,
} from "@/lib/assistant/list-match";
import { outsideOfficeHours, summarize } from "@/lib/assistant/list-match";
import { fileStore, reviewStore } from "./list-store";

// Review table of an uploaded contact list: every customer of the sheet matched to our clients, with its overdue
// and current invoices, contacts and flags. The AR team ticks the clients and presses "Approve + contact"; after
// one confirmation the approvals are saved and the text and call start (like the automatic Wednesday run).
const peso = (n: number) =>
  "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS: Record<ReviewRow["status"], { label: string; cls: string }> = {
  ready: { label: "Approved", cls: "bg-emerald-100 text-emerald-800" },
  needs_approval: { label: "Needs approval", cls: "bg-warning/20 text-foreground" },
  blocked: { label: "Blocked", cls: "bg-destructive/12 text-destructive" },
  no_match: { label: "Not found", cls: "bg-muted text-muted-foreground" },
};
const FLAG_CLS: Record<Flag["level"], string> = {
  block: "bg-destructive/10 text-destructive",
  warn: "bg-warning/20 text-foreground",
  info: "bg-muted text-muted-foreground",
};

const needsApproval = (c: ReviewClientOut) =>
  !c.approved || (c.multibranch && !c.allow_multibranch);

function InvoiceOverview({ client }: { client: ReviewClientOut }) {
  const overdue = client.invoices
    .filter((i) => i.days_overdue > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue);
  const current = client.invoices.filter((i) => i.days_overdue <= 0);
  const group = (title: string, list: ReviewInvoice[], total: number) =>
    list.length ? (
      <div className="mt-2">
        <p className="text-[11px] font-semibold">
          {title} · {list.length} invoice{list.length === 1 ? "" : "s"} · {peso(total)}
        </p>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full text-[11px]">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="pr-2 font-medium">Invoice</th>
                <th className="pr-2 font-medium">Branch</th>
                <th className="pr-2 font-medium">Due</th>
                <th className="pr-2 text-right font-medium">Days</th>
                <th className="pr-2 text-right font-medium">Balance</th>
                <th className="font-medium">Counter</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 30).map((i, k) => (
                <tr key={k} className="border-t border-border/60">
                  <td className="pr-2 py-0.5">{i.number}</td>
                  <td className="pr-2 py-0.5">{i.branch}</td>
                  <td className="pr-2 py-0.5 whitespace-nowrap">{i.due}</td>
                  <td className="pr-2 py-0.5 text-right">{i.days_overdue || ""}</td>
                  <td className="pr-2 py-0.5 text-right whitespace-nowrap">{peso(i.balance)}</td>
                  <td className="py-0.5 whitespace-nowrap">{i.counter || "not countered"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length > 30 ? (
          <p className="text-[11px] text-muted-foreground">…and {list.length - 30} more</p>
        ) : null}
      </div>
    ) : null;
  const sum = (l: ReviewInvoice[]) => l.reduce((t, i) => t + i.balance, 0);
  return (
    <div className="rounded-lg bg-muted/40 p-2 text-xs">
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Contact:</span> {client.contact_person || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Email:</span> {client.email || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Phone:</span> {client.phone || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">Branches:</span> {client.branch_count}
        </p>
        <p>
          <span className="text-muted-foreground">This cycle:</span>{" "}
          {[
            client.approved ? "approved" : "not approved",
            client.text_this_cycle ? "text sent" : "no text yet",
            client.call_this_cycle ? "call made" : "no call yet",
          ].join(" · ")}
        </p>
        {client.ar_owner || client.sales_person ? (
          <p>
            <span className="text-muted-foreground">Owner:</span>{" "}
            {[client.ar_owner, client.sales_person].filter(Boolean).join(" / ")}
          </p>
        ) : null}
        {client.collection_schedule ? (
          <p className="sm:col-span-2">
            <span className="text-muted-foreground">Collection schedule:</span>{" "}
            {client.collection_schedule}
          </p>
        ) : null}
      </div>
      {group("Overdue", overdue, sum(overdue))}
      {group("Current", current, sum(current))}
      {!client.invoices.length ? (
        <p className="mt-2 text-muted-foreground">No invoice details on file.</p>
      ) : null}
    </div>
  );
}

interface Props {
  reviewId: string;
  sessionId: string;
  getUserName: () => string;
}

export function ListReview({ reviewId, sessionId, getUserName }: Props) {
  const data = reviewStore.get(reviewId);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((data?.rows ?? []).filter((r) => r.default_selected).map((r) => r.id)),
  );
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<"review" | "confirm" | "running" | "done">(
    data?.result?.ok ? "done" : "review",
  );
  const [error, setError] = useState("");
  const [result, setResult] = useState<ContactListResult | null>(data?.result ?? null);

  if (!data)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        This list is no longer loaded (the page was reloaded). Attach the file again to review it.
      </p>
    );

  const rows = data.rows;
  const sum = summarize(rows);
  const editable = stage === "review";
  const picked = rows.filter((r) => selected.has(r.id) && r.selectable && r.client);
  const unique = [...new Map(picked.map((r) => [r.client!.client_id, r.client!])).values()];
  const toApprove = unique.filter(needsApproval);
  const overdueSum = unique.reduce((t, c) => t + c.overdue, 0);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const flip = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run() {
    if (stage !== "review" && stage !== "confirm") return;
    const who = getUserName();
    setStage("running");
    setError("");
    try {
      const res = await fetch("/api/assistant/contact-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_ids: unique.map((c) => c.client_id),
          requested_by: who,
          session_id: sessionId,
          file: `${data!.fileName} (${data!.sheet})`,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Partial<ContactListResult> & {
        error?: string;
      };
      if (!res.ok || !j.ok) {
        const partial: ContactListResult = {
          ok: false,
          accepted: j.accepted ?? [],
          approved: j.approved ?? 0,
          rejected: j.rejected ?? [],
          reply: j.reply ?? "",
          error: j.error || `Request failed (${res.status})`,
        };
        setError(partial.error ?? "Request failed");
        setResult(partial);
        setStage("review");
        // Approvals may have been saved even though the contact did not start.
        if (partial.approved) void qc.invalidateQueries();
        return;
      }
      const done = j as ContactListResult;
      data!.result = done;
      setResult(done);
      setStage("done");
      void qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStage("review");
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-card text-card-foreground">
      <div className="border-b border-border p-3">
        <p className="text-xs font-semibold">
          {data.fileName} · sheet {data.sheet}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          <span className={`rounded-full px-2 py-0.5 ${STATUS.ready.cls}`}>
            {sum.ready} approved
          </span>
          <span className={`rounded-full px-2 py-0.5 ${STATUS.needs_approval.cls}`}>
            {sum.needs_approval} need approval
          </span>
          <span className={`rounded-full px-2 py-0.5 ${STATUS.blocked.cls}`}>
            {sum.blocked} blocked
          </span>
          <span className={`rounded-full px-2 py-0.5 ${STATUS.no_match.cls}`}>
            {sum.no_match} not found
          </span>
        </div>
        {editable ? (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 font-medium hover:bg-muted"
              onClick={() =>
                setSelected(new Set(rows.filter((r) => r.default_selected).map((r) => r.id)))
              }
            >
              Select all ready ({sum.default_selected})
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 font-medium hover:bg-muted"
              onClick={() =>
                setSelected(new Set(rows.filter((r) => r.selectable).map((r) => r.id)))
              }
              title="Also selects rows with a warning (5+ branches, AR hand-off, similar name)"
            >
              Select every eligible row
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 font-medium hover:bg-muted"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
        {rows.map((r) => {
          const c = r.client;
          const st = STATUS[r.status];
          const isOpen = open.has(r.id);
          return (
            <div key={r.id} className={`p-2.5 ${r.selectable ? "" : "opacity-80"}`}>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                  checked={selected.has(r.id) && r.selectable}
                  disabled={!r.selectable || !editable}
                  onChange={() => toggle(r.id)}
                  aria-label={`Select ${r.file.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">
                      {r.file.name}
                      {c && c.client_name.toLowerCase() !== r.file.name.toLowerCase() ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          → {c.client_name}
                        </span>
                      ) : null}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}
                    >
                      {st.label}
                    </span>
                  </div>
                  {c ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.file.owner ? `${r.file.owner} · ` : ""}Overdue {peso(c.overdue)} · Current{" "}
                      {peso(c.current)} · {c.invoices.length} invoice
                      {c.invoices.length === 1 ? "" : "s"}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.file.amount != null ? `Sheet: ${peso(r.file.amount)} · ` : ""}
                      {r.suggestions.length
                        ? `Did you mean: ${r.suggestions.join(" / ")}? (not selectable: contact it by name from the chat)`
                        : "No client with this name has an open balance."}
                    </p>
                  )}
                  {r.flags.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.flags.map((f, k) => (
                        <span
                          key={k}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${FLAG_CLS[f.level]}`}
                        >
                          {f.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {c ? (
                    <button
                      type="button"
                      onClick={() => flip(r.id)}
                      className="mt-1 inline-flex items-center text-[11px] font-medium text-primary hover:underline"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      {isOpen ? "Hide overview" : "Overview"}
                    </button>
                  ) : null}
                  {c && isOpen ? (
                    <div className="mt-1.5">
                      <InvoiceOverview client={c} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3">
        {stage === "done" && result?.ok ? (
          <div className="space-y-2 text-xs">
            <p className="font-semibold text-emerald-700">
              Started for {result.accepted.length} client{result.accepted.length === 1 ? "" : "s"}
              {result.approved ? ` · ${result.approved} approved first` : ""}.
            </p>
            <p className="text-muted-foreground">
              Results and the AR report appear on the dashboard (Notifications and Reports).
            </p>
            {result.reply ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px]">
                {result.reply}
              </pre>
            ) : null}
            {result.rejected.length ? (
              <div>
                <p className="font-semibold">Not sent ({result.rejected.length}):</p>
                {result.rejected.map((x) => (
                  <p key={x.client_id} className="text-muted-foreground">
                    {x.name}: {x.reason}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : stage === "confirm" || stage === "running" ? (
          <div className="space-y-2 text-xs">
            <p className="font-semibold">
              Approve + contact {unique.length} client{unique.length === 1 ? "" : "s"}?
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {toApprove.length ? (
                <li>
                  {toApprove.length} will be approved for this cycle first (Wednesday to Tuesday).
                </li>
              ) : null}
              <li>
                Each client then gets the text reminder (email, or Viber with SMS fallback) and a
                call from Grace. This starts right away, like the Wednesday run.
              </li>
              <li>
                Calls go out about one a minute (roughly {unique.length} minute
                {unique.length === 1 ? "" : "s"} for this list). Results and one AR report appear on
                the dashboard.
              </li>
              <li>Total overdue: {peso(overdueSum)}.</li>
              {outsideOfficeHours() ? (
                <li className="font-semibold text-destructive">
                  It is outside office hours (Monday to Friday, 9 AM to 6 PM Manila). A manual
                  contact ignores office hours: clients will still be texted and called right now.
                </li>
              ) : null}
            </ul>
            <p className="text-muted-foreground">
              {unique
                .slice(0, 12)
                .map((c) => c.client_name)
                .join(" · ")}
              {unique.length > 12 ? ` · …and ${unique.length - 12} more` : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={stage === "running"}
                onClick={() => void run()}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              >
                {stage === "running" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                {stage === "running" ? "Starting…" : "Confirm"}
              </button>
              <button
                type="button"
                disabled={stage === "running"}
                onClick={() => setStage("review")}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {error ? (
              <p className="text-xs text-destructive">
                {error}
                {result?.approved ? ` (${result.approved} approvals were saved.)` : ""}
              </p>
            ) : null}
            {error && result?.rejected.length ? (
              <div className="text-[11px] text-muted-foreground">
                {result.rejected.slice(0, 6).map((x) => (
                  <p key={x.client_id}>
                    {x.name}: {x.reason}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {unique.length
                  ? `${unique.length} selected · ${peso(overdueSum)} overdue${toApprove.length ? ` · ${toApprove.length} to approve` : ""}`
                  : "Select the clients to contact."}
              </p>
              <button
                type="button"
                disabled={!unique.length}
                onClick={() => setStage("confirm")}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              >
                {toApprove.length
                  ? `Approve + contact ${unique.length}`
                  : `Contact ${unique.length}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Sheet choice after a file is attached (the AR follow-up workbook has one sheet per owner). */
export function SheetPicker({
  fileId,
  onPick,
}: {
  fileId: string;
  onPick: (sheetName: string) => void;
}) {
  const f = fileStore.get(fileId);
  if (!f)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        This file is no longer loaded (the page was reloaded). Attach it again.
      </p>
    );
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {f.sheets.map((s) => (
        <button
          key={s.name}
          type="button"
          disabled={!s.rows.length}
          title={s.rows.length ? s.note : s.note || "No customers found in this sheet"}
          onClick={() => onPick(s.name)}
          className="rounded-lg border border-border px-3 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
        >
          <span className="font-semibold">{s.name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {s.rows.length ? `${s.rows.length} customers` : "no Customer column"}
          </span>
        </button>
      ))}
    </div>
  );
}
