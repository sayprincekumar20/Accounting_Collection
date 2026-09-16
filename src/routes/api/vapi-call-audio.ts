import { createFileRoute } from "@tanstack/react-router";

// Fetches the call recording via Vapi's authenticated download endpoint,
// per docs.vapi.ai/security-and-privacy/retrieve-call-artifacts:
//   GET https://api.vapi.ai/call/{id}/mono-recording
//   Authorization: Bearer <VAPI_PRIVATE_KEY>
// -> responds with a 302 redirect to a short-lived signed URL.
//
// Buffers the full response into memory rather than streaming it through,
// and sets an explicit Content-Length + Accept-Ranges header. Streaming a
// raw ReadableStream through without Content-Length is a known cause of
// browsers reporting 0:00/0:00 duration on <audio> even when the bytes did
// arrive - the element can't determine length/seekability up front.
// Recordings here are short calls, so buffering fully is fine memory-wise.

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

          if (!audioRes.ok) {
            const upstreamBody = await audioRes.text().catch(() => "");
            console.error(
              `[vapi-call-audio] Vapi returned ${audioRes.status} for call ${callId}. Body: ${upstreamBody.slice(0, 500)}`,
            );
            return new Response(
              JSON.stringify({ error: "Recording not available", vapiStatus: audioRes.status, vapiResponse: upstreamBody.slice(0, 500) }),
              { status: audioRes.status || 502, headers: { "Content-Type": "application/json" } },
            );
          }

          const arrayBuffer = await audioRes.arrayBuffer();
          const bytes = Buffer.from(arrayBuffer);

          if (bytes.length === 0) {
            console.error(`[vapi-call-audio] Vapi returned 200 but an empty body for call ${callId}`);
            return new Response(JSON.stringify({ error: "Recording was empty" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }

          const contentType = audioRes.headers.get("content-type") || "audio/wav";

          return new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(bytes.length),
              "Accept-Ranges": "bytes",
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
