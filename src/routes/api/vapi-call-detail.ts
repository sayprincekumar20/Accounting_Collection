import { createFileRoute } from "@tanstack/react-router";
import {
  vapiFetch,
  extractClientName,
  extractSummaryAndSatisfaction,
  parseTranscript,
} from "@/lib/vapi-server";

// Direct Vapi API call — replaces the old N8N_WEBHOOK_BASE_URL proxy.
// Same response shape as before: a single CallDetail object.

export const Route = createFileRoute("/api/vapi-call-detail")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const callId = url.searchParams.get("callId");
          if (!callId) {
            return new Response(JSON.stringify({ error: "callId is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const call = await vapiFetch<any>(`/call/${encodeURIComponent(callId)}`);
          const { callSummary, satisfaction } = extractSummaryAndSatisfaction(call);

          const startedAt = call.startedAt || call.createdAt || "";
          const endedAt = call.endedAt || "";
          const durationSeconds =
            startedAt && endedAt
              ? Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000))
              : 0;

          const detail = {
            callId: call.id,
            clientName: extractClientName(call),
            phone: call.customer?.number || "",
            status: call.status || "",
            endedReason: call.endedReason || "",
            startedAt,
            durationSeconds,
            cost: call.cost ?? 0,
            // recordingUrl deliberately points at OUR proxy route, not Vapi's raw
            // R2 URL — vapi-call-audio.ts is what actually streams the bytes.
            recordingUrl: `/api/vapi-call-audio?callId=${encodeURIComponent(call.id)}`,
            callSummary,
            satisfaction,
            turns: parseTranscript(call),
          };

          return new Response(JSON.stringify(detail), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[vapi-call-detail] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch call detail" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
