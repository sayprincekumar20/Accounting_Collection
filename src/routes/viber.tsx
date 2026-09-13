import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StatCard } from "@/components/collections/Bits";

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
    <AppShell title="Logs" subtitle="Viber conversations · Telerivet · not yet connected">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total conversations" value="—" tone="primary" />
        <StatCard label="Replied" value="—" />
        <StatCard label="Not replied" value="—" />
        <StatCard label="Promises to pay" value="—" hint="Confirmed on Viber" />
      </div>

      <section className="surface-card mt-5 overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.1em]">Conversations</h2>
          <span className="text-xs text-muted-foreground">0 logged</span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">ID</th>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Summary</th>
                <th className="px-4 py-2.5 font-semibold">Promise date</th>
                <th className="px-4 py-2.5 font-semibold">Escalated</th>
                <th className="px-4 py-2.5 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={7} className="px-4 py-10">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <MessageCircle className="h-8 w-8 text-muted-foreground" />
                    <h3 className="text-sm font-bold">Viber isn't wired up yet</h3>
                    <p className="max-w-md text-xs text-muted-foreground">
                      Once Viber's live Telerivet credentials are configured, this tab will show real
                      conversations in exactly the same layout as SMS, WhatsApp, Email, and Voice.
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
