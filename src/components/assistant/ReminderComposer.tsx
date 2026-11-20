import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  Paperclip,
  RotateCcw,
  Send,
} from "lucide-react";
import {
  CHANNEL_LABEL,
  REMINDER_CHANNELS,
  SMS_MAX,
  VIBER_MAX,
  smsLength,
  validateReminder,
  type ReminderChannel,
  type ReminderDraft,
} from "@/lib/reminder-templates";
import type { ReminderPreview } from "@/lib/reminder-server";

// AI assistant: send one reminder on the channel the person chooses. The channel's PRE-APPROVED template is
// loaded (exactly what the automatic run sends), can be edited (except WhatsApp: Meta-approved, fixed), is
// checked against the channel's rules as you type, and is sent only after an explicit confirmation step.
type Step = "edit" | "confirm" | "sending" | "sent";

export function ReminderComposer({
  clientId,
  initialChannel,
  getUserName,
}: {
  clientId: string;
  initialChannel?: ReminderChannel | undefined;
  getUserName: () => string;
}) {
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [channel, setChannel] = useState<ReminderChannel | null>(initialChannel ?? null);
  const [draft, setDraft] = useState<ReminderDraft>({ subject: "", body: "" });
  const [step, setStep] = useState<Step>("edit");
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/reminder/preview?client_id=${encodeURIComponent(clientId)}`);
        const j = (await r.json().catch(() => ({}))) as ReminderPreview & { error?: string };
        if (!r.ok) throw new Error(j.error || `Could not load the templates (${r.status})`);
        if (!alive) return;
        setPreview(j);
        // Start on the requested channel, or the first one that can reach the client.
        const first =
          (initialChannel && j.channels[initialChannel]?.available ? initialChannel : null) ??
          REMINDER_CHANNELS.find((c) => j.channels[c].available) ??
          null;
        if (first) {
          setChannel(first);
          setDraft({ ...j.channels[first].template });
        }
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "Could not load the templates");
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, initialChannel]);

  const opt = channel && preview ? preview.channels[channel] : null;
  const errors = useMemo(() => (channel ? validateReminder(channel, draft) : []), [channel, draft]);
  const edited =
    !!opt &&
    (draft.body !== opt.template.body ||
      (channel === "EMAIL" && draft.subject !== opt.template.subject));

  const pick = (c: ReminderChannel) => {
    if (!preview || step !== "edit") return;
    setChannel(c);
    setDraft({ ...preview.channels[c].template });
    setResult(null);
  };

  async function send() {
    if (!preview || !channel) return;
    const name = getUserName();
    if (!name) return;
    setStep("sending");
    setResult(null);
    try {
      const r = await fetch("/api/reminder/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          channel,
          subject: draft.subject,
          body: draft.body,
          acknowledged: ack,
          requested_by: name,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        errors?: string[];
        warnings?: string[];
      };
      if (j.status === "sent") {
        setStep("sent");
        setResult({ ok: true, text: j.message || "Sent" });
        return;
      }
      setStep(j.status === "needs_ack" ? "confirm" : "edit");
      setResult({
        ok: false,
        text:
          j.status === "needs_ack"
            ? "Please confirm the warnings first."
            : j.message || `Not sent (${r.status})`,
        ...(j.errors ? { errors: j.errors } : {}),
      });
    } catch {
      setStep("confirm");
      setResult({
        ok: false,
        text: "The reminder could not be sent (network error). Nothing was sent.",
      });
    }
  }

  if (loadError) return <p className="mt-2 text-xs text-destructive">{loadError}</p>;
  if (!preview)
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading the approved templates…
      </p>
    );

  const c = preview.client;
  const peso = (n: number) =>
    "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      className="mt-2 space-y-2 rounded-xl border border-border bg-card p-3 text-xs"
      aria-label="Reminder composer"
    >
      <div>
        <p className="text-sm font-semibold">Send a reminder · {c.client_name}</p>
        <p className="text-muted-foreground">
          Overdue {peso(c.overdue)} · total {peso(c.total)}
          {c.contact_person ? ` · ${c.contact_person}` : ""}
        </p>
      </div>

      {preview.blocked ? (
        <p className="rounded-lg bg-destructive/10 px-2 py-1.5 font-semibold text-destructive">
          Cannot be sent: {preview.blocked}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Channel">
        {REMINDER_CHANNELS.map((ch) => {
          const o = preview.channels[ch];
          return (
            <button
              key={ch}
              type="button"
              role="radio"
              aria-checked={channel === ch}
              disabled={!o.available || step !== "edit"}
              title={o.available ? "" : o.reason}
              onClick={() => {
                pick(ch);
              }}
              className={`rounded-full px-3 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${channel === ch ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
            >
              {CHANNEL_LABEL[ch]}
            </button>
          );
        })}
      </div>
      {REMINDER_CHANNELS.filter((ch) => !preview.channels[ch].available).map((ch) => (
        <p key={ch} className="text-[11px] text-muted-foreground">
          {CHANNEL_LABEL[ch]} unavailable: {preview.channels[ch].reason}
        </p>
      ))}

      {channel && opt ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            {opt.editable
              ? edited
                ? "Edited from the approved template."
                : "Approved template for this channel. You can edit it before sending."
              : "WhatsApp only delivers Meta-approved templates: this message is sent exactly as shown."}
          </p>
          {channel === "EMAIL" ? (
            <label className="block">
              <span className="font-semibold">Subject</span>
              <input
                value={draft.subject}
                disabled={step !== "edit"}
                onChange={(e) => {
                  setDraft({ ...draft, subject: e.target.value });
                }}
                className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5"
              />
            </label>
          ) : null}
          {opt.editable ? (
            <textarea
              aria-label="Message"
              value={draft.body}
              disabled={step !== "edit"}
              onChange={(e) => {
                setDraft({ ...draft, body: e.target.value });
              }}
              rows={channel === "SMS" ? 3 : 8}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 font-sans"
            />
          ) : (
            <p className="flex gap-1.5 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-2 py-1.5">
              <Lock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              {draft.body}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {channel === "SMS" ? (
              <span
                className={smsLength(draft.body) > SMS_MAX ? "font-semibold text-destructive" : ""}
              >
                {smsLength(draft.body)} / {SMS_MAX} characters · one SMS
              </span>
            ) : channel === "VIBER" ? (
              <span
                className={draft.body.length > VIBER_MAX ? "font-semibold text-destructive" : ""}
              >
                {draft.body.length} / {VIBER_MAX} characters
              </span>
            ) : null}
            {opt.attachment ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {opt.attachment}
              </span>
            ) : null}
            {opt.editable && edited && step === "edit" ? (
              <button
                type="button"
                onClick={() => {
                  setDraft({ ...opt.template });
                }}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <RotateCcw className="h-3 w-3" /> Back to the approved template
              </button>
            ) : null}
          </div>
          {errors.length ? (
            <ul className="space-y-0.5 text-destructive" aria-label="Channel rules">
              {errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : null}

          {step === "edit" ? (
            <button
              type="button"
              disabled={!!preview.blocked || !!errors.length || !opt.available}
              onClick={() => {
                setStep("confirm");
                setResult(null);
              }}
              className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-40"
            >
              Review and send…
            </button>
          ) : null}

          {step === "confirm" || step === "sending" ? (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-2">
              <p className="font-semibold">
                Send this {CHANNEL_LABEL[channel]} reminder to{" "}
                {channel === "EMAIL" ? c.email : c.phone}
                {opt.attachment && !opt.attachment.startsWith("no ")
                  ? ", with the statement PDF"
                  : ""}
                ?
              </p>
              {preview.warnings.length ? (
                <div className="space-y-1">
                  {preview.warnings.map((w) => (
                    <p key={w} className="flex gap-1 text-warning">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                    </p>
                  ))}
                  <label className="flex items-center gap-1.5 font-semibold">
                    <input
                      type="checkbox"
                      checked={ack}
                      onChange={(e) => {
                        setAck(e.target.checked);
                      }}
                    />
                    I have read these and still want to send it
                  </label>
                </div>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={step === "sending" || (preview.warnings.length > 0 && !ack)}
                  onClick={() => void send()}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {step === "sending" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Confirm and send
                </button>
                <button
                  type="button"
                  disabled={step === "sending"}
                  onClick={() => {
                    setStep("edit");
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 font-semibold"
                >
                  Back to edit
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : !preview.blocked ? (
        <p className="text-muted-foreground">
          No channel can reach this client: fix the contact details in Zoho.
        </p>
      ) : null}

      {result ? (
        <div className={result.ok ? "text-success" : "text-destructive"}>
          <p className="inline-flex items-center gap-1 font-semibold">
            {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
            {result.ok ? `Sent: ${result.text}` : result.text}
          </p>
          {result.errors?.map((e) => (
            <p key={e}>• {e}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
