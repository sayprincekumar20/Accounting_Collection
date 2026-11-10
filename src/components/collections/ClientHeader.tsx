import { useQuery } from "@tanstack/react-query";
import { CreditLine } from "@/components/collections/CreditLine";
import { ScheduleLine } from "@/components/collections/ScheduleBadge";
import { EscalationBadge, PromiseBadge } from "@/components/collections/ClientDetailDialogs";
import { ownerName } from "@/lib/owner";

// Key fields of a client at the top of its page (data: /api/client-snapshot).
interface Snap {
  found: boolean;
  client_id: string;
  client_name: string;
  ar_owner: string;
  credit_terms: string;
  credit_limit: number | null;
  collection_schedule: string;
  approved_this_cycle: boolean;
  promise: { date: string; channel: string } | null;
  open_escalations: number;
}
const day = (v: string) =>
  v
    ? new Date(v).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "";

export function ClientHeader({ clientId }: { clientId: string }) {
  const { data } = useQuery({
    queryKey: ["client-snapshot", clientId],
    queryFn: async () => {
      const r = await fetch(`/api/client-snapshot?client_id=${encodeURIComponent(clientId)}`);
      if (!r.ok) throw new Error("Fetch failed");
      return (await r.json()) as Snap;
    },
    enabled: !!clientId,
  });
  if (!data?.found) return null;
  return (
    <div className="surface-card mb-4 flex flex-wrap items-start justify-between gap-3 p-4">
      <div className="text-sm">
        <p>
          <span className="text-muted-foreground">Account Owner: </span>
          <span className="font-semibold">{ownerName(data.ar_owner) || "–"}</span>
        </p>
        <ScheduleLine value={data.collection_schedule} />
        <CreditLine terms={data.credit_terms} limit={data.credit_limit} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${data.approved_this_cycle ? "bg-success/12 text-success" : "bg-warning/15 text-warning"}`}
        >
          {data.approved_this_cycle ? "Approved this cycle" : "Not approved this cycle"}
        </span>
        {data.promise ? (
          <PromiseBadge
            clientId={data.client_id}
            clientName={data.client_name}
            label={`Promise ${day(data.promise.date)}`}
          />
        ) : null}
        {data.open_escalations ? (
          <EscalationBadge
            clientId={data.client_id}
            clientName={data.client_name}
            label={`${data.open_escalations} open escalation${data.open_escalations > 1 ? "s" : ""}`}
          />
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            No open escalations
          </span>
        )}
      </div>
    </div>
  );
}
