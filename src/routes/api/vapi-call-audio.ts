import { createFileRoute } from "@tanstack/react-router";
import { vapiFetch } from "@/lib/vapi-server";

// Direct Vapi API call — replaces the old N8N_WEBHOOK_BASE_URL proxy
// (n8n's "voice-recording-proxy" webhook). Same behavior: fetch the call
// detail server-side (with our auth), pull the recording URL, download the
// bytes server-side, and stream them back — the browser never touches
// Vapi's locked-down R2 URL directly.

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

          const call = await vapiFetch<any>(`/call/${encodeURIComponent(callId)}`);
          // VERIFY against a real completed call: Vapi has used different keys
          // across API versions for this (recordingUrl at the top level vs.
          // nested under artifact). Try the common ones in order.
          const recordingUrl: string | undefined =
            call?.artifact?.recordingUrl ||
            call?.artifact?.stereoRecordingUrl ||
            call?.recordingUrl ||
            call?.artifact?.mono?.recordingUrl;

          if (!recordingUrl) {
            return new Response(JSON.stringify({ error: "Recording not available" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          const audioRes = await fetch(recordingUrl);
          if (!audioRes.ok || !audioRes.body) {
            return new Response(JSON.stringify({ error: "Recording not available" }), {
              status: audioRes.status || 502,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(audioRes.body, {
            status: 200,
            headers: {
              "Content-Type": audioRes.headers.get("content-type") ?? "audio/wav",
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
