import type { LiveStatus } from "@/hooks/useLiveCollections";

const label: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  offline: "Reconnecting…",
};

export function LiveIndicator({
  status,
  lastEventAt,
  compact = false,
}: {
  status: LiveStatus;
  lastEventAt: Date | null;
  compact?: boolean;
}) {
  const tone =
    status === "live"
      ? "bg-success"
      : status === "offline"
        ? "bg-destructive"
        : "bg-warning";

  return (
    <span
      className={
        compact
          ? "inline-flex items-center gap-2 text-xs text-ink-foreground"
          : "inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium"
      }
      title={
        lastEventAt ? `Last update ${lastEventAt.toLocaleTimeString()}` : "Waiting for updates"
      }
    >
      <span className="relative flex h-2 w-2">
        {status === "live" ? (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone} opacity-60`} />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone}`} />
      </span>
      {label[status]}
      {lastEventAt ? (
        <span className={compact ? "text-ink-muted" : "text-muted-foreground"}>
          · {lastEventAt.toLocaleTimeString()}
        </span>
      ) : null}
    </span>
  );
}
