import { createFileRoute } from "@tanstack/react-router";

// Fetches the call recording via Vapi's authenticated download endpoint.
//
// IMPORTANT (verified against docs.vapi.ai/security-and-privacy/retrieve-call-artifacts):
// call.artifact.recordingUrl / stereoRecordingUrl are DEPRECATED as of Vapi's
// August 2025 changelog. Recordings now live behind:
//   GET https://api.vapi.ai/call/{id}/mono-recording
//   GET https://api.vapi.ai/call/{id}/stereo-recording
// sent with `Authorization: Bearer <VAPI_PRIVATE_KEY>`, which responds with a
// 302 redirect to a short-lived signed URL. fetch() follows redirects by
// default, so this just streams whatever comes back.

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

          const audioRes = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(callId)}/mono-recording`, {
            headers: { Authorization: `Bearer ${process.env["VAPI_PRIVATE_KEY"] || ""}` },
          });

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
