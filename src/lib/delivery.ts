// Delivery status of an outgoing message, the same for every channel (Telerivet SMS / Viber, Twilio
// WhatsApp, logged email sends): failed, delivered, read, sent or pending.
export type DeliveryState = "failed" | "delivered" | "read" | "sent" | "pending" | "";

export function deliveryState(status: unknown): DeliveryState {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (
    [
      "failed",
      "failed_queued",
      "not_delivered",
      "undelivered",
      "cancelled",
      "canceled",
      "error",
      "rejected",
      "send_failed",
    ].includes(s)
  )
    return "failed";
  if (s === "read") return "read";
  if (s === "delivered") return "delivered";
  if (["sent", "send_success", "success"].includes(s)) return "sent";
  if (["queued", "accepted", "scheduled", "processing", "sending", "pending"].includes(s))
    return "pending";
  return "";
}

export const isFailed = (status: unknown) => deliveryState(status) === "failed";
