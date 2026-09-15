import { createFileRoute } from "@tanstack/react-router";

// Fetches the call recording via Vapi's authenticated download endpoint,
// per docs.vapi.ai/security-and-privacy/retrieve-call-artifacts:
//   GET https://api.vapi.ai/call/{id}/mono-recording
//   Authorization: Bearer <VAPI_PRIVATE_KEY>
// -> responds with a 302 redirect to a short-lived signed URL. fetch()
// follows redirects by default (explicit here for clarity), so this
// should transparently receive the actual audio bytes.
//
// If this still fails, the JSON error body now includes Vapi's real
// upstream status and response text (visible in the Network tab or by
// hitting this route directly in the browser) instead of a generic
// message, so the actual cause is visible without a separate curl test.

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

          const privateKey = (process.env["VAPI_PRIVATE_KEY"] || "").trim();
          if (!privateKey) {
            return new Response(JSON.stringify({ error: "VAPI_PRIVATE_KEY is not set on the server" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const audioRes = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(callId)}/mono-recording`, {
            headers: { Authorization: `Bearer ${privateKey}` },
            redirect: "follow",
          });

          if (!audioRes.ok || !audioRes.body) {
            const upstreamBody = await audioRes.text().catch(() => "");
            console.error(
              `[vapi-call-audio] Vapi returned ${audioRes.status} for call ${callId}. Body: ${upstreamBody.slice(0, 500)}`,
            );
            return new Response(
              JSON.stringify({
                error: "Recording not available",
                vapiStatus: audioRes.status,
                vapiResponse: upstreamBody.slice(0, 500),
              }),
              {
                status: audioRes.status || 502,
                headers: { "Content-Type": "application/json" },
              },
            );
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
          return new Response(JSON.stringify({ error: "Failed to fetch call recording", detail: String(err) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
