// Loading placeholders in the shape of the content (instead of a 'Loading…' text).
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/5 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
  );
}

export function SkeletonBlock({ className = "h-40" }: { className?: string }) {
  return (
    <div
      className={`${className} animate-pulse rounded-xl bg-muted`}
      aria-busy="true"
      aria-label="Loading"
    />
  );
}
