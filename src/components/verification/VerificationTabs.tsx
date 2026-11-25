import { Link } from "@tanstack/react-router";

/** Reviews | Document expiry | Document requests, at the top of the Document Verification pages. */
export function VerificationTabs({
  active,
}: {
  active: "reviews" | "expiry" | "requests" | "batches";
}) {
  const base = "rounded-lg px-4 py-2 text-sm font-semibold";
  const tab = (on: boolean) =>
    `${base} ${on ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`;
  return (
    <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
      <Link to="/verification" className={tab(active === "reviews")}>
        Reviews
      </Link>
      <Link to="/verification/expiry" className={tab(active === "expiry")}>
        Document expiry
      </Link>
      <Link to="/verification/requests" className={tab(active === "requests")}>
        Document requests
      </Link>
      <Link to="/verification/batches" className={tab(active === "batches")}>
        Batch check
      </Link>
    </div>
  );
}
