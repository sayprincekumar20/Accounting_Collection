import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

// Public document upload page (no login): opened from a document request email. Shows only the company
// name and its checklist; files go to the Account in Zoho CRM, then the account is verified again.
export const Route = createFileRoute("/upload/$token")({
  head: () => ({
    meta: [
      { title: "Upload documents | Rare Global Food" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UploadPage,
});

type Doc = { type: string; label: string; reason: string; received: boolean };
type Page = {
  account_name: string;
  status: string;
  documents: Doc[];
  expires_at: string | null;
  open: boolean;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const body = await r.json().catch(() => null);
  if (!r.ok)
    throw new Error((body as { detail?: string } | null)?.detail || "Something went wrong");
  return body as T;
}

function UploadPage() {
  const { token } = Route.useParams();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setPage(await call<Page>(`/api/upload/${token}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(doc: Doc, file: File) {
    setBusy(doc.type);
    setError(null);
    try {
      const form = new FormData();
      form.set("document_type", doc.type);
      form.set("file", file);
      await call(`/api/upload/${token}/files`, { method: "POST", body: form });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    setError(null);
    try {
      await call(`/api/upload/${token}/submit`, { method: "POST" });
      setDone(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const received = page?.documents.filter((d) => d.received).length ?? 0;
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-xl">
        <p className="text-sm font-bold tracking-wide text-primary">RARE GLOBAL FOOD</p>
        <h1 className="mt-1 text-2xl font-semibold">Upload documents</h1>
        {page ? <p className="mt-1 text-muted-foreground">{page.account_name}</p> : null}

        {error ? (
          <p className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {page && (done || page.status === "Submitted") ? (
          <p className="mt-6 rounded-lg border border-success/30 bg-success/10 p-4 text-sm">
            Thank you. The documents were received and are being checked. You can close this page.
          </p>
        ) : null}

        {page && !page.open && page.status !== "Submitted" ? (
          <p className="mt-6 rounded-lg border border-border bg-muted p-4 text-sm">
            This link is no longer open ({page.status.toLowerCase()}). Please ask Rare Global Food
            for a new link.
          </p>
        ) : null}

        {page && page.open ? (
          <>
            <p className="mt-6 text-sm">
              Please upload each document below as a PDF or a clear photo. When you have uploaded
              them, press <strong>Send for checking</strong>.
              {page.expires_at
                ? ` This link is valid until ${new Date(page.expires_at).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })}.`
                : ""}
            </p>
            <ul className="mt-5 space-y-3">
              {page.documents.map((d) => (
                <li key={d.type} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{d.label}</p>
                      <p className="text-xs text-muted-foreground">{d.reason}</p>
                    </div>
                    {d.received ? (
                      <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
                        Received
                      </span>
                    ) : null}
                  </div>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">
                    {busy === d.type
                      ? "Uploading…"
                      : d.received
                        ? "Upload another file"
                        : "Choose file"}
                    <input
                      type="file"
                      className="sr-only"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.tif,.tiff,.doc,.docx,image/*,application/pdf"
                      disabled={busy !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void upload(d, f);
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {received} of {page.documents.length} uploaded
              </p>
              <button
                type="button"
                disabled={!received || busy !== null}
                onClick={submit}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy === "submit" ? "Sending…" : "Send for checking"}
              </button>
            </div>
          </>
        ) : null}
        {!page && !error ? <p className="mt-6 text-sm text-muted-foreground">Loading…</p> : null}
        <p className="mt-10 text-xs text-muted-foreground">
          Your files are sent securely to Rare Global Food and used only to verify this account.
        </p>
      </div>
    </main>
  );
}
