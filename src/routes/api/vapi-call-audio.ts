import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vapi-call-audio")({
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
          // n8n's voice-recording-proxy calls Vapi's authenticated
          // GET /call/{id}/mono-recording endpoint server-side and streams the
          // audio bytes back - the raw recordingUrl from vapi-call-detail points
          // at a locked-down R2 bucket that a browser <audio> tag can't play directly.
          const res = await fetch(
            `${process.env["N8N_WEBHOOK_BASE_URL"]}/voice-recording-proxy?callId=${encodeURIComponent(callId)}`,
          );
          if (!res.ok || !res.body) {
            return new Response(JSON.stringify({ error: "Recording not available" }), {
              status: res.status || 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(res.body, {
            status: 200,
            headers: {
              "Content-Type": res.headers.get("content-type") ?? "audio/wav",
              "Cache-Control": "private, max-age=1200",
            },
          });
        } catch (err) {
          console.error("[vapi-call-audio] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch call recording" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
