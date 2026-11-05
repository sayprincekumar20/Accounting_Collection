import { deliveryState } from "@/lib/delivery";

/** Delivery status under an outgoing message: Failed (with reason), Delivered, Read, Sent or Pending. */
export function DeliveryBadge({
  status,
  error,
}: {
  status?: string | undefined;
  error?: string | undefined;
}) {
  const st = deliveryState(status);
  if (!st) return null;
  if (st === "failed")
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-bold text-destructive"
        title={error || "Not delivered"}
      >
        ✕ Failed{error ? `: ${error.slice(0, 80)}` : ": not delivered"}
      </span>
    );
  const map = {
    read: { label: "✓✓ Read", cls: "bg-success/12 text-success" },
    delivered: { label: "✓ Delivered", cls: "bg-success/12 text-success" },
    sent: { label: "Sent", cls: "bg-muted text-muted-foreground" },
    pending: { label: "Sending…", cls: "bg-warning/15 text-warning" },
  } as const;
  const m = map[st];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>
  );
}
