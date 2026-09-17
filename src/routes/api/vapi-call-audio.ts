import { createFileRoute } from "@tanstack/react-router";
import { vapiFetch } from "@/lib/vapi-server";

// Proxies the call recording that Vapi already exposes directly on the call
// object (call.recordingUrl or call.artifact.recordingUrl).
//
// NOTE: this project previously called Vapi's separate authenticated-redirect
// endpoint (GET /call/{id}/mono-recording, per
// docs.vapi.ai/security-and-privacy/retrieve-call-artifacts). That endpoint
// is specifically for HIPAA-enabled orgs whose recordings live in a private
// bucket needing a short-lived signed-URL redirect. For a non-HIPAA account
// there's no such private-bucket artifact to redirect to, so Vapi returns
// 400 even though the call has a perfectly normal recordingUrl sitting on
// the call object already (confirmed via GET /call/{id}). So: fetch the call,
// read that URL, and proxy those bytes instead.
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

          const call = await vapiFetch<any>(`/call/${encodeURIComponent(callId)}`);
          const recordingUrl: string | undefined = call.recordingUrl || call.artifact?.recordingUrl;

          if (!recordingUrl) {
            return new Response(JSON.stringify({ error: "Recording not available for this call" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          const audioRes = await fetch(recordingUrl);

          if (!audioRes.ok) {
            const upstreamBody = await audioRes.text().catch(() => "");
            console.error(
              `[vapi-call-audio] recordingUrl fetch returned ${audioRes.status} for call ${callId}. Body: ${upstreamBody.slice(0, 500)}`,
            );
            return new Response(
              JSON.stringify({ error: "Recording not available", upstreamStatus: audioRes.status }),
              { status: audioRes.status || 502, headers: { "Content-Type": "application/json" } },
            );
          }

          const arrayBuffer = await audioRes.arrayBuffer();
          const bytes = Buffer.from(arrayBuffer);

          if (bytes.length === 0) {
            console.error(`[vapi-call-audio] recordingUrl returned 200 but an empty body for call ${callId}`);
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