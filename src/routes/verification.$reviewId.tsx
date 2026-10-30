import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, ExternalLink, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Panel, RefreshButton } from "@/components/collections/Bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dvRequest,
  getReviewerName,
  isDecidable,
  isOpen,
  RECOMMENDATION_TONE,
  recommendationLabel,
  setReviewerName,
  STATUS_TONE,
  when,
  type ActivationCheck,
  type ReviewDetail,
  type ReviewRow,
} from "@/lib/dv";

export const Route = createFileRoute("/verification/$reviewId")({
  head: () => ({ meta: [{ title: "Review | Document Verification" }] }),
  component: ReviewPage,
});

const SEVERITY_TONE: Record<string, string> = {
  URGENT: "bg-destructive/10 text-foreground",
  ATTENTION: "bg-warning/12 text-foreground",
  NOTE: "bg-muted text-foreground",
};

function ReviewPage() {
  const { reviewId } = Route.useParams();
  const qc = useQueryClient();
  const {
    data: review,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dv-review", reviewId],
    queryFn: () => dvRequest<ReviewDetail>(`/api/dv-reviews/${reviewId}`),
  });
  const [name, setName] = useState("");
  const [dialog, setDialog] = useState<null | "approve" | "reject" | "request-documents">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => setName(getReviewerName()), []);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["dv-review", reviewId] });
    await qc.invalidateQueries({ queryKey: ["dv-reviews"] });
  };
  const needName = () => {
    if (name.trim()) return false;
    setMessage({ tone: "error", text: "Enter your name first (it is saved with every decision)." });
    return true;
  };

  if (isLoading) {
    return (
      <AppShell title="Document Verification">
        <p className="text-sm text-muted-foreground">Loading review…</p>
      </AppShell>
    );
  }
  if (error || !review) {
    return (
      <AppShell title="Document Verification">
        <p className="text-sm text-destructive">
          Could not load the review: {(error as Error | null)?.message ?? "not found"}
        </p>
        <Link to="/verification" className="mt-3 inline-block text-sm font-semibold text-primary">
          Back to the list
        </Link>
      </AppShell>
    );
  }

  const open = isOpen(review.status);
  const checks = review.summary.activation_checks ?? [];
  const met = checks.filter((c) => c.status === "PASS").length;

  return (
    <AppShell
      title={review.account_name || review.account_id}
      subtitle={`${review.number} · ${review.customer_number || "no customer number"} · requested by ${review.requested_by || "—"} on ${when(review.created_at)}${review.summary.request_reason ? ` · reason: ${review.summary.request_reason}` : ""}`}
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/verification"
            className="mr-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> All reviews
          </Link>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[review.status] ?? "bg-muted"}`}
          >
            {review.status}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${RECOMMENDATION_TONE[review.recommendation] ?? "bg-muted"}`}
          >
            Recommendation: {recommendationLabel(review.recommendation)}
          </span>
          {review.reviewer ? (
            <span className="text-xs text-muted-foreground">Reviewer: {review.reviewer}</span>
          ) : null}
        </div>
        {open ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => !needName() && setDialog("request-documents")}
              className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-muted"
            >
              Request documents
            </button>
            <button
              type="button"
              onClick={() => !needName() && setDialog("reject")}
              className="h-10 rounded-lg border border-destructive/40 bg-card px-4 text-sm font-semibold text-destructive hover:bg-destructive/5"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => !needName() && setDialog("approve")}
              className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Approve…
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="surface-card mt-4 flex flex-wrap items-center gap-3 p-3">
          <label htmlFor="dv-reviewer" className="text-sm font-semibold">
            Reviewing as
          </label>
          <input
            id="dv-reviewer"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setReviewerName(e.target.value);
            }}
            placeholder="Your name or email (saved on this computer)"
            className="h-9 min-w-[260px] flex-1 rounded-lg border border-border bg-background px-2.5 text-sm"
          />
        </div>
      ) : null}

      {message ? (
        <p
          role="status"
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${message.tone === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
        >
          {message.text}
        </p>
      ) : null}

      {!open && review.reviewer_notes ? (
        <div className="mt-4">
          <Panel
            title="Decision"
            description={`${review.status} by ${review.reviewer ?? "—"} on ${when(review.closed_at)}`}
          >
            <p className="whitespace-pre-line px-4 py-3 text-sm">{review.reviewer_notes}</p>
            {review.activated ? (
              <p className="px-4 pb-3 text-sm font-semibold text-success">
                Customer Status set to Active.
              </p>
            ) : null}
          </Panel>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Panel
          title="Activation checks"
          description={checks.length ? `${met} of ${checks.length} met` : undefined}
        >
          <ul className="space-y-3 px-4 py-3">
            {checks.map((c) => (
              <CheckLine key={c.key} check={c} />
            ))}
            {!checks.length ? (
              <li className="text-sm text-muted-foreground">No checks recorded.</li>
            ) : null}
          </ul>
        </Panel>
        <Panel title="Alerts">
          <ul className="space-y-2 px-4 py-3">
            {lines(review.summary.alerts).map((line, i) => {
              const word =
                line
                  .replace(/^\d+\.\s*/, "")
                  .split(":")[0]
                  ?.trim()
                  .toUpperCase() ?? "";
              return (
                <li
                  key={i}
                  className={`rounded-lg px-3 py-2 text-sm ${SEVERITY_TONE[word] ?? "bg-muted"}`}
                >
                  {line.replace(/^\d+\.\s*/, "")}
                </li>
              );
            })}
            {!lines(review.summary.alerts).length ? (
              <li className="text-sm text-muted-foreground">No alerts.</li>
            ) : null}
          </ul>
        </Panel>
        <Panel
          title="Required documents"
          description={`${review.summary.documents_found ?? 0} found`}
        >
          <ul className="space-y-2 px-4 py-3 text-sm">
            {lines(review.summary.required_documents).map((line, i) => {
              const ok = line.startsWith("✓");
              const bad = line.startsWith("✗");
              return (
                <li key={i} className="flex items-start gap-2">
                  {ok ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-success"
                      aria-label="valid"
                    />
                  ) : null}
                  {bad ? (
                    <XCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                      aria-label="problem"
                    />
                  ) : null}
                  <span className="min-w-0 break-words">{line.replace(/^[✓✗?]\s*/, "")}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Why this recommendation">
          <p className="whitespace-pre-line px-4 py-3 text-sm">
            {review.summary.recommendation_reasons || "—"}
          </p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <Panel
          title="Proposed changes"
          description={
            open
              ? "Only rows marked Approve or Edit are written to the Zoho Account"
              : "Result of the write-back"
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Field</th>
                  <th className="px-4 py-2.5 font-semibold">In Zoho now</th>
                  <th className="px-4 py-2.5 font-semibold">From documents</th>
                  <th className="px-4 py-2.5 font-semibold">Check</th>
                  <th className="px-4 py-2.5 font-semibold">{open ? "Decision" : "Outcome"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {review.rows.map((row) => (
                  <ChangeRow
                    key={row.id}
                    row={row}
                    reviewId={review.id}
                    open={open}
                    needName={needName}
                    onSaved={refresh}
                    onError={(text) => setMessage({ tone: "error", text })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <DocumentViewer reviewId={review.id} pages={review.pages} />
      </div>

      <ApproveDialog
        review={review}
        open={dialog === "approve"}
        onClose={() => setDialog(null)}
        onDone={async (text) => {
          setDialog(null);
          setMessage({ tone: "ok", text });
          await refresh();
        }}
      />
      <CloseDialog
        reviewId={review.id}
        kind={dialog === "reject" || dialog === "request-documents" ? dialog : null}
        onClose={() => setDialog(null)}
        onDone={async (text) => {
          setDialog(null);
          setMessage({ tone: "ok", text });
          await refresh();
        }}
      />
    </AppShell>
  );
}

function lines(text: string | null | undefined): string[] {
  return (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function CheckLine({ check }: { check: ActivationCheck }) {
  const Icon = check.status === "PASS" ? CheckCircle2 : check.status === "FAIL" ? XCircle : Clock3;
  const tone =
    check.status === "PASS"
      ? "text-success"
      : check.status === "FAIL"
        ? "text-destructive"
        : "text-warning";
  const word =
    check.status === "PASS" ? "met" : check.status === "FAIL" ? "not met" : "met after the update";
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-label={word} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{check.label}</p>
        <p className="break-words text-xs text-muted-foreground">{check.detail}</p>
      </div>
    </li>
  );
}

const DECISIONS = ["Approve", "Edit", "Reject"] as const;
const DECISION_ON: Record<string, string> = {
  Approve: "bg-success text-success-foreground",
  Edit: "bg-primary text-primary-foreground",
  Reject: "bg-destructive text-destructive-foreground",
};

function ChangeRow({
  row,
  reviewId,
  open,
  needName,
  onSaved,
  onError,
}: {
  row: ReviewRow;
  reviewId: string;
  open: boolean;
  needName: () => boolean;
  onSaved: () => Promise<void>;
  onError: (text: string) => void;
}) {
  const [draft, setDraft] = useState(row.edited_value ?? row.proposed_value ?? "");
  const [busy, setBusy] = useState(false);
  const decidable = isDecidable(row);

  const save = async (decision: string, value?: string) => {
    if (needName()) return;
    setBusy(true);
    try {
      await dvRequest(`/api/dv-reviews/${reviewId}/rows/${row.id}`, {
        method: "PUT",
        body: JSON.stringify({ decision, value: value ?? null }),
      });
      await onSaved();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={decidable ? "" : "text-muted-foreground"}>
      <td className="px-4 py-3 align-top">
        <p className="font-semibold text-foreground">{row.field_label || row.zoho_field}</p>
        <p className="text-xs text-muted-foreground">
          {(row.action || "").replace(/_/g, " ").toLowerCase()}
          {row.auto_applied === "Applied" ? " · written automatically" : ""}
        </p>
      </td>
      <td className="px-4 py-3 align-top break-words">{row.current_value || <em>empty</em>}</td>
      <td className="px-4 py-3 align-top">
        <p className="break-words font-semibold text-foreground">{row.proposed_value || "—"}</p>
        {open && row.decision === "Edit" ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor={`edit-${row.id}`}>
              Corrected value for {row.field_label || row.zoho_field}
            </label>
            <input
              id={`edit-${row.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-9 min-w-[200px] flex-1 rounded-lg border border-primary bg-background px-2.5 text-sm"
            />
            <button
              type="button"
              disabled={busy || !draft.trim() || draft === row.edited_value}
              onClick={() => save("Edit", draft)}
              className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Save value
            </button>
          </div>
        ) : null}
        {!open && row.decision === "Edit" && row.edited_value ? (
          <p className="mt-1 text-xs">Edited to: {row.edited_value}</p>
        ) : null}
        {row.evidence ? (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Evidence</summary>
            <p className="mt-1 whitespace-pre-line break-words">{row.evidence}</p>
          </details>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top text-xs">
        <p>{row.confidence != null ? `Confidence ${Number(row.confidence).toFixed(2)}` : "—"}</p>
        <p className="text-muted-foreground">
          {row.ocr_check ? `OCR ${String(row.ocr_check).toLowerCase()}` : ""}
        </p>
      </td>
      <td className="px-4 py-3 align-top">
        {open && decidable ? (
          <div
            role="group"
            aria-label={`Decision for ${row.field_label || row.zoho_field}`}
            className="inline-flex overflow-hidden rounded-lg border border-border"
          >
            {DECISIONS.map((d) => {
              const on = row.decision === d;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() =>
                    d === "Edit"
                      ? save("Edit", draft || row.proposed_value || "")
                      : save(on ? "Pending" : d)
                  }
                  className={`h-9 border-l border-border px-3 text-xs font-semibold first:border-l-0 disabled:opacity-60 ${on ? DECISION_ON[d] : "bg-card hover:bg-muted"}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        ) : open ? (
          <span className="text-xs">Information only</span>
        ) : (
          <div className="text-xs">
            <p className="font-semibold text-foreground">{row.decision}</p>
            {row.outcome ? <p>{row.outcome.replace(/_/g, " ").toLowerCase()}</p> : null}
          </div>
        )}
      </td>
    </tr>
  );
}

function DocumentViewer({ reviewId, pages }: { reviewId: string; pages: ReviewDetail["pages"] }) {
  const [current, setCurrent] = useState(pages[0]?.n ?? 0);
  const page = pages.find((p) => p.n === current);
  return (
    <Panel
      title="Documents"
      description={
        pages.length
          ? "Compare each value with the page"
          : "No page images (removed 30 days after closing)"
      }
    >
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {pages.map((p) => (
            <button
              key={p.n}
              type="button"
              aria-pressed={p.n === current}
              onClick={() => setCurrent(p.n)}
              className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${p.n === current ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
            >
              {p.file} · p{p.page}
            </button>
          ))}
        </div>
        {page ? (
          <>
            <img
              src={`/api/dv-reviews/${reviewId}/pages/${page.n}`}
              alt={`${page.file}, page ${page.page}`}
              className="max-h-[720px] w-full rounded-lg border border-border bg-muted object-contain"
            />
            <a
              href={`/api/dv-reviews/${reviewId}/pages/${page.n}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Open full size <ExternalLink className="h-3 w-3" />
            </a>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function ApproveDialog({
  review,
  open,
  onClose,
  onDone,
}: {
  review: ReviewDetail;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [compared, setCompared] = useState(false);
  const [activate, setActivate] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const write = review.rows.filter(
    (r) => isDecidable(r) && (r.decision === "Approve" || r.decision === "Edit"),
  );
  const rejected = review.rows.filter((r) => isDecidable(r) && r.decision === "Reject");
  const pending = review.rows.filter((r) => isDecidable(r) && r.decision === "Pending");
  const checks = review.summary.activation_checks ?? [];
  const met = checks.filter((c) => c.status === "PASS").length;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await dvRequest<{
        status: string;
        activated: boolean | null;
        error: string | null;
      }>(`/api/dv-reviews/${review.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          values_compared: compared,
          activate_account: activate,
          notes: notes || null,
        }),
      });
      await onDone(
        `${review.number}: ${res.status}${res.activated ? " · Customer Status set to Active" : ""}${res.error ? ` · ${res.error}` : ""}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Approve and apply to the Zoho Account?</DialogTitle>
          <DialogDescription>
            {review.number} · {review.account_name}. Each value is re-checked against the Account
            first; a field changed in Zoho meanwhile is not written (Conflict).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold text-success">Will be written ({write.length})</p>
            {write.length ? (
              <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[480px] text-xs">
                  <thead>
                    <tr className="bg-muted text-left text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Field</th>
                      <th className="px-3 py-2 font-semibold">In Zoho now</th>
                      <th className="px-3 py-2 font-semibold">Will become</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {write.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 font-semibold">{r.field_label || r.zoho_field}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.current_value || "empty"}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {r.decision === "Edit" ? r.edited_value : r.proposed_value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-1 text-muted-foreground">
                Nothing: no row is marked Approve or Edit.
              </p>
            )}
          </div>
          <p className="text-muted-foreground">
            Rejected: {rejected.length} · Left pending (not written): {pending.length}
          </p>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={compared}
              onChange={(e) => setCompared(e.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            <span>
              <strong>I compared every approved value with the source document</strong> (required)
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={activate}
              onChange={(e) => setActivate(e.target.checked)}
              className="mt-0.5 h-5 w-5"
            />
            <span>
              <strong>Activate the account</strong>: set Customer Status to Active after writing.
              <span className="block text-xs text-muted-foreground">
                Activation checks: {met} of {checks.length} met.
              </span>
            </span>
          </label>
          <label className="block">
            <span className="font-semibold">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
            />
          </label>
          {error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
          >
            Back to review
          </button>
          <button
            type="button"
            disabled={!compared || busy}
            onClick={submit}
            className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy
              ? "Applying…"
              : `Apply ${write.length} change${write.length === 1 ? "" : "s"}${activate ? " and activate" : ""}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({
  reviewId,
  kind,
  onClose,
  onDone,
}: {
  reviewId: string;
  kind: "reject" | "request-documents" | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isReject = kind === "reject";
  const submit = async () => {
    if (!kind) return;
    setBusy(true);
    setError("");
    try {
      await dvRequest(`/api/dv-reviews/${reviewId}/${kind}`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      });
      setNotes("");
      await onDone(
        isReject
          ? "Review rejected. Nothing was written to Zoho."
          : "Marked as waiting for documents.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={kind !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isReject ? "Reject this review?" : "Request documents"}</DialogTitle>
          <DialogDescription>
            {isReject
              ? "Nothing is written to the Zoho Account. Say why (required)."
              : "Say which documents the customer must send (required). Verify the Account again once they arrive."}
          </DialogDescription>
        </DialogHeader>
        <label className="block text-sm">
          <span className="font-semibold">{isReject ? "Reason" : "Documents needed"}</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
          />
        </label>
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!notes.trim() || busy}
            onClick={submit}
            className={`h-10 rounded-lg px-5 text-sm font-semibold disabled:opacity-50 ${isReject ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}
          >
            {busy ? "Saving…" : isReject ? "Reject" : "Request documents"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
