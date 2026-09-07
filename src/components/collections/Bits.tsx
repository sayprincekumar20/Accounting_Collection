import { useEffect, useState, type ReactNode } from "react";
import { channelMeta, peso, timeAgo } from "@/lib/collections";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "default" | "primary" | undefined;
}) {
  return (
    <div
      className={
        tone === "primary"
          ? "rounded-xl bg-primary p-4 text-primary-foreground shadow-[var(--shadow-raised)]"
          : "surface-card p-4"
      }
    >
      <p
        className={
          tone === "primary"
            ? "text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80"
            : "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        }
      >
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {hint ? (
        <p
          className={
            tone === "primary"
              ? "mt-1 text-xs opacity-80"
              : "mt-1 text-xs text-muted-foreground"
          }
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ChannelBadge({ channel }: { channel: string }) {
  const meta = channelMeta(channel);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{
        color: meta.colorVar,
        backgroundColor: `color-mix(in oklab, ${meta.colorVar} 14%, transparent)`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: meta.colorVar }}
      />
      {meta.label}
    </span>
  );
}

const statusTone: Record<string, string> = {
  delivered: "bg-success/12 text-success",
  read: "bg-success/12 text-success",
  sent: "bg-secondary text-secondary-foreground",
  completed: "bg-success/12 text-success",
  received: "bg-muted text-muted-foreground",
  queued: "bg-warning/18 text-warning",
  pending: "bg-warning/18 text-warning",
  failed: "bg-destructive/12 text-destructive",
  no_answer: "bg-destructive/12 text-destructive",
  no_contact: "bg-destructive/12 text-destructive",
  escalated: "bg-destructive/12 text-destructive",
  overdue: "bg-destructive/12 text-destructive",
  promise_to_pay: "bg-success/12 text-success",
  email_only: "bg-warning/18 text-warning",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
        statusTone[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <section className="surface-card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.1em]">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Amount({ value }: { value: number }) {
  return <span className="font-semibold tabular-nums">{peso(value)}</span>;
}

/** Locale/timezone-dependent timestamp rendered only on the client (avoids SSR mismatch). */
export function ClientTime({
  value,
  options,
}: {
  value: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(
      new Date(value).toLocaleString(
        "en-PH",
        options ?? {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{label}</>;
}

export function TimeAgo({ value }: { value: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(timeAgo(value));
    const id = setInterval(() => setLabel(timeAgo(value)), 60000);
    return () => clearInterval(id);
  }, [value]);
  return <>{label}</>;
}
