import { createFileRoute } from "@tanstack/react-router";
import { vapiFetch, extractClientId, extractClientName, extractSummaryAndSatisfaction } from "@/lib/vapi-server";
import { getEnv } from "@/lib/env";

// Direct Vapi API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
// Same response shape as before: { calls: CallListItem[] }

export const Route = createFileRoute("/api/vapi-calls-list")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const assistantId = await getEnv("VAPI_ASSISTANT_ID");
          const qs = new URLSearchParams({ limit: "100" });
          if (assistantId) qs.set("assistantId", assistantId);

          const rawCalls = await vapiFetch<any[]>(`/call?${qs.toString()}`);

          const calls = (rawCalls || []).map((call) => {
            const { callSummary, satisfaction } = extractSummaryAndSatisfaction(call);
            const hasContent = !!(call.transcript || call.artifact?.transcript);
            const preview = (call.transcript || call.artifact?.transcript || "").slice(0, 140);

            return {
              call_id: call.id,
              client_id: extractClientId(call),
              client_name: extractClientName(call),
              phone: call.customer?.number || "",
              status: call.status || "",
              endedReason: call.endedReason || "",
              startedAt: call.startedAt || call.createdAt || "",
              cost: call.cost ?? 0,
              hasContent,
              preview,
              callSummary,
              satisfactionOverall: satisfaction?.overall ?? null,
            };
          });

          calls.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

          return new Response(JSON.stringify({ calls }), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[vapi-calls-list] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch voice calls" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
