import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dvRequest, getReviewerName, type RequestDoc, type RequestDraft } from "@/lib/dv";

/** Request documents (or a renewal) by Gmail from the Account Owner or the customer: a pre-filled,
 *  editable email with the documents needed and a secure upload link. */
export function RequestDialog({
  accountId,
  reviewId,
  documents,
  title = "Request documents",
  onClose,
  onSent,
}: {
  accountId: string;
  reviewId?: string;
  documents?: string[];
  title?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const reviewer = typeof window !== "undefined" ? getReviewerName() : "";
  const [recipient, setRecipient] = useState<"owner" | "customer">("owner");
  const only = documents?.length ? `&documents=${documents.join(",")}` : "";
  const draft = useQuery({
    queryKey: ["dv-request-draft", accountId, recipient, only],
    queryFn: () =>
      dvRequest<RequestDraft>(
        `/api/dv-requests/draft?account_id=${accountId}&recipient=${recipient}${only}`,
      ),
  });
  const d = draft.data;
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [docs, setDocs] = useState<RequestDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!d) return;
    setTo(d.to);
    setCc(d.cc);
    setSubject(d.subject);
    setBody(d.body);
    setDocs(d.documents);
  }, [d]);

  async function send() {
    if (!reviewer) {
      setError("Enter your name in 'Reviewing as' on a review page first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await dvRequest<{ link: string }>("/api/dv-requests", {
        method: "POST",
        body: JSON.stringify({
          account_id: accountId,
          recipient_kind: recipient,
          to,
          cc,
          subject,
          body,
          documents: docs,
          review_id: reviewId,
        }),
      });
      setLink(res.link);
      onSent?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
    >
      <div className="mt-8 w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">
              {d ? `${d.account_name}${d.customer_number ? ` · ${d.customer_number}` : ""}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {link ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
              Sent to {to}. The upload link is valid for 14 days; uploaded files are attached to the
              Account in Zoho and the account is verified again.
            </p>
            <div className="flex gap-2">
              <input readOnly value={link} className={field} aria-label="Upload link" />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(link)}
                className="shrink-0 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted"
              >
                Copy link
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Send to
              </legend>
              {(["owner", "customer"] as const).map((k) => {
                const person = k === "owner" ? d?.recipients.owner : d?.recipients.customer;
                const disabled = k === "customer" && !d?.recipients.customer;
                return (
                  <label
                    key={k}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${recipient === k ? "border-primary bg-primary/5" : "border-border"} ${disabled ? "opacity-50" : ""}`}
                  >
                    <input
                      type="radio"
                      name="dv-recipient"
                      checked={recipient === k}
                      disabled={disabled}
                      onChange={() => setRecipient(k)}
                    />
                    <span>
                      <span className="font-semibold">
                        {k === "owner" ? "Account Owner" : "Customer"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {disabled
                          ? "no Accounting or primary contact with an email"
                          : `${person?.name || ""} ${person?.email ? `· ${person.email}` : ""}`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {draft.isLoading ? (
              <p className="text-sm text-muted-foreground">Preparing the email…</p>
            ) : null}
            {draft.error ? (
              <p className="text-sm text-destructive">{(draft.error as Error).message}</p>
            ) : null}

            {d ? (
              <>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Documents to request
                  </p>
                  {d.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing is missing or expired on this account.
                    </p>
                  ) : null}
                  <div className="space-y-1">
                    {d.documents.map((doc) => (
                      <label key={doc.type} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={docs.some((x) => x.type === doc.type)}
                          onChange={(e) =>
                            setDocs(
                              e.target.checked
                                ? [...docs, doc]
                                : docs.filter((x) => x.type !== doc.type),
                            )
                          }
                        />
                        {doc.label} <span className="text-muted-foreground">({doc.reason})</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label className="block text-sm">
                  <span className="text-xs font-semibold text-muted-foreground">To</span>
                  <input value={to} onChange={(e) => setTo(e.target.value)} className={field} />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-semibold text-muted-foreground">CC (optional)</span>
                  <input value={cc} onChange={(e) => setCc(e.target.value)} className={field} />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-semibold text-muted-foreground">Subject</span>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className={field}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-semibold text-muted-foreground">Email</span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={14}
                    className={`${field} font-mono text-[13px] leading-relaxed`}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  {d.placeholder} is replaced by the secure upload link when the email is sent.
                </p>
              </>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !d || !docs.length || !to.trim()}
                onClick={send}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send by Gmail"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
