import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Panel, RefreshButton, StatCard } from "@/components/collections/Bits";
import { VerificationTabs } from "@/components/verification/VerificationTabs";
import { dvRequest, REQUEST_TONE, when, type DocumentRequestItem } from "@/lib/dv";

export const Route = createFileRoute("/verification/requests")({
  head: () => ({ meta: [{ title: "Document Requests | Document Verification" }] }),
  component: RequestsPage,
});

const CARDS = [
  { id: "Requested", hint: "Waiting for uploads (reminder after 3 days)" },
  { id: "Partly received", hint: "Checked automatically 24 h after the last upload" },
  { id: "Submitted", hint: "Uploaded and sent for checking" },
  { id: "Expired", hint: "Link expired before uploads" },
];

function RequestsPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["dv-requests"],
    queryFn: () => dvRequest<{ items: DocumentRequestItem[] }>("/api/dv-requests"),
    refetchInterval: 120000,
  });
  const items = data?.items ?? [];
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const visible = items.filter(
    (i) =>
      (filter === "ALL" || i.status === filter) &&
      (!q ||
        `${i.account_name} ${i.customer_number ?? ""} ${i.recipient_email} ${i.requested_by ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );

  async function resend(i: DocumentRequestItem) {
    setNote(null);
    try {
      await dvRequest(`/api/dv-requests/${i.id}/resend`, { method: "POST" });
      setNote(`Sent again to ${i.recipient_email}.`);
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  return (
    <AppShell
      title="Document Verification"
      subtitle="Documents requested by email, with their upload link and what has been received"
      actions={<RefreshButton isFetching={isFetching} onRefresh={() => refetch()} />}
    >
      <VerificationTabs active="requests" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <StatCard
            key={c.id}
            label={c.id}
            value={String(items.filter((i) => i.status === c.id).length)}
            hint={c.hint}
            tone={c.id === "Requested" ? "primary" : "default"}
            onClick={() => setFilter(filter === c.id ? "ALL" : c.id)}
            active={filter === c.id}
          />
        ))}
      </div>

      <div className="surface-card mt-5 flex flex-wrap items-center gap-2.5 p-3">
        <label className="sr-only" htmlFor="dv-req-search">
          Search requests
        </label>
        <input
          id="dv-req-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search account, customer number, recipient, sent by…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-background px-2.5 text-sm"
        />
        {note ? <span className="text-sm">{note}</span> : null}
      </div>

      <div className="mt-5">
        <Panel
          title="Requests"
          description={`${visible.length} shown · newest first · send a request from a review (Request documents) or Document expiry (Request renewal)`}
        >
          {isLoading ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p> : null}
          {error ? (
            <p className="px-4 py-6 text-sm text-destructive">
              Could not load the requests: {(error as Error).message}
            </p>
          ) : null}
          {!isLoading && !error && visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No requests here.</p>
          ) : null}
          {visible.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Account</th>
                    <th className="px-4 py-2.5 font-semibold">Documents</th>
                    <th className="px-4 py-2.5 font-semibold">Sent to</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold">Sent</th>
                    <th className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((i) => (
                    <tr key={i.id} className="align-top hover:bg-muted/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{i.account_name}</p>
                        <p className="text-xs text-muted-foreground">{i.customer_number || "—"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {i.documents.map((d) => (
                          <p key={d.type} className="text-xs">
                            <span className={d.received ? "text-success" : "text-muted-foreground"}>
                              {d.received ? "✓" : "○"}
                            </span>{" "}
                            {d.label} <span className="text-muted-foreground">({d.reason})</span>
                          </p>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="font-semibold">
                          {i.recipient_kind === "customer" ? "Customer" : "Account Owner"}
                        </p>
                        <p className="break-all text-muted-foreground">{i.recipient_email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${REQUEST_TONE[i.status] ?? "bg-muted"}`}
                        >
                          {i.status}
                        </span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {i.uploads.length} file{i.uploads.length === 1 ? "" : "s"} received
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <p>{when(i.created_at)}</p>
                        <p className="text-muted-foreground">by {i.requested_by || "—"}</p>
                        {i.link ? (
                          <p className="text-muted-foreground">link until {when(i.expires_at)}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {i.link ? (
                          <div className="flex flex-col gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(i.link ?? "");
                                setNote("Link copied.");
                              }}
                              className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                            >
                              Copy link
                            </button>
                            <button
                              type="button"
                              onClick={() => void resend(i)}
                              className="whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                            >
                              Resend
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      </div>
    </AppShell>
  );
}
