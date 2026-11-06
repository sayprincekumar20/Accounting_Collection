import { useState } from "react";
import { Send, CheckCircle2, Loader2 } from "lucide-react";

export type ReplyComposerChannel = "email" | "sms" | "whatsapp" | "viber";

function getErrorMessage(error: unknown, channel: ReplyComposerChannel) {
  const message = error instanceof Error ? error.message : "Failed to send reply";
  if (
    channel === "email" &&
    (message.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
      message.includes("insufficient authentication scopes"))
  ) {
    return "Gmail is not authorized to send. Reauthorize Google access with the gmail.send permission.";
  }

  const jsonStart = message.indexOf(": {");
  if (jsonStart >= 0) {
    try {
      const details = JSON.parse(message.slice(jsonStart + 2)) as {
        error?: { message?: string; code?: number };
      };
      if (details.error?.message) {
        return details.error.code
          ? `Provider error (${details.error.code}): ${details.error.message}`
          : details.error.message;
      }
    } catch {
      return message;
    }
  }

  return message;
}

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
      setError(getErrorMessage(err, channel));
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
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="block text-sm font-semibold text-foreground">{channelLabel}</label>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={email || phone}>
            To {email || phone || "No recipient available"}
          </p>
        </div>
        <div className="shrink-0" aria-live="polite">
          {isSending ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending
            </span>
          ) : sent ? (
            <span className="inline-flex max-w-40 items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{sendStatus}</span>
            </span>
          ) : null}
        </div>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        aria-label={`${channelLabel} message`}
        placeholder={
          channel === "email"
            ? "Write a human reply for this client..."
            : "Type the message to send to this client..."
        }
        rows={3}
        className="min-h-24 max-h-48 w-full resize-y rounded-xl border border-border bg-background px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 placeholder:text-muted-foreground"
      />
      {recipientMissing ? (
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
          {channel === "email"
            ? "This thread has no email address to reply to."
            : "This conversation has no phone number to reply to."}
        </p>
      ) : null}
      {error ? (
        <div
          className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5"
          role="alert"
        >
          <p className="text-xs font-semibold text-destructive">Message could not be sent</p>
          <p className="mt-1 max-h-20 overflow-y-auto break-words text-xs leading-relaxed text-foreground">
            {error}
          </p>
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {isSending ? "Sending…" : "Send reply"}
        </button>
      </div>
    </form>
  );
}
