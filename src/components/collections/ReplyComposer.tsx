import { useState } from "react";
import { Send, CheckCircle2, Loader2 } from "lucide-react";

export type ReplyComposerChannel = "email" | "sms" | "whatsapp" | "viber";

export function ReplyComposer({
  channel,
  clientName,
  email,
  phone,
  threadId,
  subject,
  onSent,
}: {
  channel: ReplyComposerChannel;
  clientName?: string;
  email?: string;
  phone?: string;
  threadId?: string;
  subject?: string;
  onSent?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

  const recipientMissing = channel === "email" ? !email?.trim() : !phone?.trim();
  const disabled = isSending || !message.trim() || recipientMissing;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;

    setIsSending(true);
    setError(null);
    const payload: Record<string, string> = {
      message: message.trim(),
      clientName: clientName || "",
    };

    if (channel === "email") {
      payload["email"] = email || "";
      payload["subject"] = subject || "";
      if (threadId) payload["threadId"] = threadId;
    } else {
      payload["phone"] = phone || "";
      if (clientName) payload["clientName"] = clientName;
    }

    try {
      const endpointMap: Record<ReplyComposerChannel, string> = {
        email: "/api/gmail-send",
        sms: "/api/sms-send",
        whatsapp: "/api/whatsapp-send",
        viber: "/api/viber-send",
      };

      const res = await fetch(endpointMap[channel], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        result?: { status?: string };
      };
      if (!res.ok) {
        throw new Error(body.error || body.message || "Failed to send reply");
      }
      setMessage("");
      setSendStatus(
        body.result?.status ? `Accepted (${body.result.status})` : "Accepted by provider",
      );
      setSent(true);
      setTimeout(() => setSent(false), 2000);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setIsSending(false);
    }
  }

  const channelLabel =
    channel === "email"
      ? "Reply by email"
      : channel === "sms"
        ? "Reply by SMS"
        : channel === "whatsapp"
          ? "Reply on WhatsApp"
          : "Reply on Viber";

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {channelLabel}
        </label>
        {sent ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> {sendStatus}
          </span>
        ) : null}
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          channel === "email"
            ? "Write a human reply for this client..."
            : "Type the message to send to this client..."
        }
        rows={5}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0 placeholder:text-muted-foreground focus:border-primary"
      />
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {recipientMissing ? (
        <p className="mt-2 text-xs text-destructive">
          Cannot send:{" "}
          {channel === "email"
            ? "no email address is available for this thread."
            : "no phone number is available for this conversation."}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {channel === "email" ? email || "No email on file" : phone || "No phone on file"}
        </span>
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {isSending ? "Sending..." : "Send reply"}
        </button>
      </div>
    </form>
  );
}
