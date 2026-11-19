import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { WorklistContent } from "./worklist";

export const Route = createFileRoute("/escalations")({
  head: () => ({ meta: [{ title: "Escalations | Rare Global Food Collections" }] }),
  // Old links to the former "System notifications" tab open the System Notifications page.
  beforeLoad: ({ location }) => {
    if ((location.search as Record<string, unknown>)["tab"] === "notifications")
      throw redirect({ href: "/notifications" });
  },
  component: EscalationsPage,
});

/**
 * Customer escalations only: disputes, payment issues, unresolved conversations, callback requests and other
 * cases that need the AR team (raised by the AI agents and Grace), with Ref, status and notes.
 * System messages (workflow failures, automation errors) are on the System Notifications page.
 */
function EscalationsPage() {
  return (
    <AppShell
      title="Escalations"
      subtitle="Customer cases that need the AR team: disputes, payment issues, unresolved conversations, follow-ups · Ref, status and notes"
    >
      <WorklistContent />
    </AppShell>
  );
}
