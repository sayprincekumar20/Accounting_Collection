import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { WorklistContent } from "./worklist";
import { NotificationsContent } from "./notifications";

export const Route = createFileRoute("/escalations")({
  head: () => ({ meta: [{ title: "Escalations | Rare Global Food Collections" }] }),
  component: EscalationsPage,
});

/**
 * Everything that needs attention in one place:
 *  - Client escalations (former AR Worklist): client issues raised by the AI agents / Grace, with Ref and status.
 *  - System notifications (former Notifications): errors, run results, daily check, close-out, callbacks.
 */
function EscalationsPage() {
  const initial =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tab") === "notifications"
      ? "notifications"
      : "worklist";
  const [tab, setTab] = useState<"worklist" | "notifications">(initial);
  const tabBtn = (k: "worklist" | "notifications", label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(k);
        window.history.replaceState(null, "", `/escalations?tab=${k}`);
      }}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === k ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <AppShell
      title="Escalations"
      subtitle={
        tab === "worklist"
          ? "Client issues raised by the AI agents and Grace for the AR team · Ref, status and notes"
          : "System messages: errors, contact results, daily check, cycle close-out, client callbacks"
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {tabBtn("worklist", "Client escalations")}
        {tabBtn("notifications", "System notifications")}
      </div>
      {tab === "worklist" ? <WorklistContent /> : <NotificationsContent />}
    </AppShell>
  );
}
