import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, MessageCircle, MessageSquare, Phone, Send, X } from "lucide-react";
import { CallAgainButton } from "./CallAgainButton";
import {
  channelOptions,
  findEmailThread,
  findPhoneConversation,
  normalizePhMobile,
  type ContactChannel,
  type ContactClient,
} from "@/lib/contact-channels";

// "Contact" on the Clients module: pick a channel. Viber / SMS / WhatsApp / Email open the most recent
// conversation with this client on that page; if there is none yet, the first message can be sent from here.
// "Call" places one call with Grace (same as "Call again").

const ICON: Record<ContactChannel, typeof Mail> = {
  email: Mail,
  viber: MessageCircle,
  sms: MessageSquare,
  whatsapp: MessageCircle,
  call: Phone,
};
const PAGE: Record<Exclude<ContactChannel, "call">, string> = {
  email: "/email",
  viber: "/viber",
  sms: "/sms",
  whatsapp: "/whatsapp",
};
const LIST_API: Record<Exclude<ContactChannel, "call">, string> = {
  email: "/api/gmail-threads-list",
  viber: "/api/viber-conversations",
  sms: "/api/sms-conversations",
  whatsapp: "/api/whatsapp-conversations",
};

const when = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

export function ContactClientButton({ client }: { client: ContactClient }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
      >
        Contact
      </button>
      {open ? <ContactClientDialog client={client} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ContactClientDialog({
  client,
  onClose,
}: {
  client: ContactClient;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<ContactChannel | null>(null);
  const options = channelOptions(client);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-semibold">Contact {client.client_name}</p>
            <p className="text-xs text-muted-foreground">
              {[client.contact_person, client.email, client.phone].filter(Boolean).join(" · ") ||
                "No contact details on file"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Choose a channel
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {options.map((o) => {
            const Icon = ICON[o.channel];
            return (
              <button
                key={o.channel}
                type="button"
                disabled={!o.available}
                title={o.available ? o.label : o.why}
                onClick={() => setChannel(o.channel)}
                className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                  channel === o.channel
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {o.label}
              </button>
            );
          })}
        </div>
        {options.some((o) => !o.available) ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {options
              .filter((o) => !o.available)
              .map((o) => `${o.label}: ${o.why}`)
              .join(" · ")}
          </p>
        ) : null}
        <div className="mt-4">
          {channel === "call" ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Grace calls {client.client_name} once, right now. No text is sent.
              </p>
              <CallAgainButton clientId={client.client_id} clientName={client.client_name} />
            </div>
          ) : channel ? (
            <ChannelPanel key={channel} client={client} channel={channel} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChannelPanel({
  client,
  channel,
}: {
  client: ContactClient;
  channel: Exclude<ContactChannel, "call">;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["contact-lookup", channel],
    queryFn: async () => {
      const r = await fetch(LIST_API[channel]);
      if (!r.ok) throw new Error(`Could not load the ${channel} conversations (${r.status})`);
      return (await r.json()) as Record<string, unknown>;
    },
    staleTime: 60_000,
  });
  const found =
    channel === "email"
      ? findEmailThread(client, (data?.["threads"] as unknown[]) ?? [])
      : findPhoneConversation(client, (data?.["conversations"] as unknown[]) ?? []);
  const href = found ? `${PAGE[channel]}?open=${encodeURIComponent(found.open)}` : PAGE[channel];

  const [subject, setSubject] = useState(`Rare Global Food - ${client.client_name}`);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function send() {
    setState("sending");
    setMsg("");
    try {
      let r: Response;
      if (channel === "email") {
        r = await fetch("/api/gmail-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: client.email, subject, message: text }),
        });
      } else if (channel === "whatsapp") {
        r = await fetch("/api/whatsapp-template", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: client.client_id }),
        });
      } else {
        const phone = normalizePhMobile(client.phone);
        if (!phone) throw new Error("The phone number is not a valid Philippine mobile number.");
        r = await fetch(channel === "viber" ? "/api/viber-send" : "/api/sms-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, message: text, clientId: client.client_id }),
        });
      }
      const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!r.ok) throw new Error(j.error || j.detail || `Sending failed (${r.status})`);
      setState("sent");
      setText("");
      void qc.invalidateQueries();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sending failed");
      setState("error");
    }
  }

  const name = { email: "Email", viber: "Viber", sms: "SMS", whatsapp: "WhatsApp" }[channel];
  return (
    <div className="space-y-3 text-sm">
      {isLoading ? (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Looking for a {name} conversation…
        </p>
      ) : error ? (
        <p className="text-xs text-destructive">{(error as Error).message}</p>
      ) : found ? (
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Most recent {name} conversation · {when(found.lastAt)}
          </p>
          {found.preview ? <p className="mt-1 line-clamp-2 text-sm">{found.preview}</p> : null}
          <a
            href={href}
            className="mt-2 inline-flex rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Open the conversation
          </a>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No {name} conversation with this client yet. You can send the first message here.
        </p>
      )}

      {channel === "whatsapp" ? (
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">
            WhatsApp only allows a business to start a conversation with an approved template. This
            sends the standard overdue reminder template (with the statement link) to {client.phone}
            .
          </p>
          <button
            type="button"
            disabled={state === "sending"}
            onClick={() => void send()}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            <Send className="h-3 w-3" /> Send the WhatsApp reminder
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-xs font-semibold">
            {found ? `Send a new ${name} message` : `First ${name} message`}
            <span className="font-normal text-muted-foreground">
              {" "}
              to {channel === "email" ? client.email : client.phone}
            </span>
          </p>
          {channel === "email" ? (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
              placeholder="Subject"
              aria-label="Subject"
            />
          ) : null}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="Write your message…"
            aria-label="Message"
          />
          <button
            type="button"
            disabled={!text.trim() || state === "sending"}
            onClick={() => void send()}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            {state === "sending" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            Send {name}
          </button>
        </div>
      )}
      {state === "sent" ? (
        <p className="text-xs text-success">
          Sent. It appears in the {name} page shortly.{" "}
          <a href={href} className="underline">
            Open {name}
          </a>
        </p>
      ) : null}
      {state === "error" ? <p className="text-xs text-destructive">{msg}</p> : null}
    </div>
  );
}
