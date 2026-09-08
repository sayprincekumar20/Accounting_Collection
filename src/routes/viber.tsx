import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/viber")({
  head: () => ({
    meta: [
      { title: "Viber Inbox | Rare Global Food Collections" },
      {
        name: "description",
        content: "Viber conversations for overdue clients — coming soon, pending live backend credentials.",
      },
      { property: "og:title", content: "Viber Inbox | Rare Global Food Collections" },
    ],
  }),
  component: ViberInbox,
});

function ViberInbox() {
  return (
    <AppShell title="Viber Inbox" subtitle="Not yet connected">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <MessageCircle className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">Viber isn't wired up yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Viber's live backend credentials aren't configured yet. Once they are, this page will
          show real conversations the same way SMS, WhatsApp, Email, and Voice already do.
        </p>
      </div>
    </AppShell>
  );
}
