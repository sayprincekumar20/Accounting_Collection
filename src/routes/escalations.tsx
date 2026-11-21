import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { WorklistContent } from "./worklist";
import { NotificationsContent } from "./notifications";

type Tab = "customer" | "system";

// One Escalations module, two separate tabs that are never mixed:
//  - Customer escalations: cases a client raised that need the AR team (disputes, payment claims,
//    callbacks, document requests, wrong contacts), with Ref, status and notes.
//  - System notifications: workflow failures, automation and integration errors, run results.
// The AI assistant can analyse both ("Diagnose with AI" on each item) and records its diagnosis, the
// actions taken and the resolution in each issue's history.
export const Route = createFileRoute("/escalations")({
  head: () => ({ meta: [{ title: "Escalations | Rare Global Food Collections" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const t = String(search["tab"] ?? "");
    // "notifications" = the older link to the system tab
    return t === "system" || t === "notifications" ? { tab: "system" } : {};
  },
  component: EscalationsPage,
});

const TABS: { id: Tab; label: string; hint: string }[] = [
  {
    id: "customer",
    label: "Customer escalations",
    hint: "Cases clients raised that need the AR team",
  },
  {
    id: "system",
    label: "System notifications",
    hint: "Workflow failures, automation and integration errors",
  },
];

function EscalationsPage() {
  const { tab = "customer" } = Route.useSearch();
  return (
    <AppShell
      title="Escalations"
      subtitle="Customer escalations and system notifications, kept apart · the AI assistant can diagnose both"
    >
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Escalation type">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to="/escalations"
            search={t.id === "system" ? { tab: "system" } : {}}
            role="tab"
            aria-selected={tab === t.id}
            title={t.hint}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "border border-border hover:bg-muted"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "system" ? <NotificationsContent /> : <WorklistContent />}
    </AppShell>
  );
}
