// import { createFileRoute } from "@tanstack/react-router";
// import { vapiFetch } from "@/lib/vapi-server";

// // Proxies the call recording that Vapi already exposes directly on the call
// // object (call.recordingUrl or call.artifact.recordingUrl).
// //
// // NOTE: this project previously called Vapi's separate authenticated-redirect
// // endpoint (GET /call/{id}/mono-recording, per
// // docs.vapi.ai/security-and-privacy/retrieve-call-artifacts). That endpoint
// // is specifically for HIPAA-enabled orgs whose recordings live in a private
// // bucket needing a short-lived signed-URL redirect. For a non-HIPAA account
// // there's no such private-bucket artifact to redirect to, so Vapi returns
// // 400 even though the call has a perfectly normal recordingUrl sitting on
// // the call object already (confirmed via GET /call/{id}). So: fetch the call,
// // read that URL, and proxy those bytes instead.
// //
// // Buffers the full response into memory rather than streaming it through,
// // and sets an explicit Content-Length + Accept-Ranges header. Streaming a
// // raw ReadableStream through without Content-Length is a known cause of
// // browsers reporting 0:00/0:00 duration on <audio> even when the bytes did
// // arrive - the element can't determine length/seekability up front.
// // Recordings here are short calls, so buffering fully is fine memory-wise.

// export const Route = createFileRoute("/api/vapi-call-audio")({
//   server: {
//     handlers: {
//       GET: async ({ request }) => {
//         try {
//           const url = new URL(request.url);
//           const callId = url.searchParams.get("callId");
//           if (!callId) {
//             return new Response(JSON.stringify({ error: "callId is required" }), {
//               status: 400,
//               headers: { "Content-Type": "application/json" },
//             });
//           }

//           const call = await vapiFetch<any>(`/call/${encodeURIComponent(callId)}`);
//           const recordingUrl: string | undefined = call.recordingUrl || call.artifact?.recordingUrl;

//           if (!recordingUrl) {
//             return new Response(JSON.stringify({ error: "Recording not available for this call" }), {
//               status: 404,
//               headers: { "Content-Type": "application/json" },
//             });
//           }

//           const audioRes = await fetch(recordingUrl);

//           if (!audioRes.ok) {
//             const upstreamBody = await audioRes.text().catch(() => "");
//             console.error(
//               `[vapi-call-audio] recordingUrl fetch returned ${audioRes.status} for call ${callId}. Body: ${upstreamBody.slice(0, 500)}`,
//             );
//             return new Response(
//               JSON.stringify({ error: "Recording not available", upstreamStatus: audioRes.status }),
//               { status: audioRes.status || 502, headers: { "Content-Type": "application/json" } },
//             );
//           }

//           const arrayBuffer = await audioRes.arrayBuffer();
//           const bytes = Buffer.from(arrayBuffer);

//           if (bytes.length === 0) {
//             console.error(`[vapi-call-audio] recordingUrl returned 200 but an empty body for call ${callId}`);
//             return new Response(JSON.stringify({ error: "Recording was empty" }), {
//               status: 502,
//               headers: { "Content-Type": "application/json" },
//             });
//           }

//           const contentType = audioRes.headers.get("content-type") || "audio/wav";

//           return new Response(bytes, {
//             status: 200,
//             headers: {
//               "Content-Type": contentType,
//               "Content-Length": String(bytes.length),
//               "Accept-Ranges": "bytes",
//               "Cache-Control": "private, max-age=1200",
//             },
//           });
//         } catch (err) {
//           console.error("[vapi-call-audio] fetch error:", err);
//           return new Response(JSON.stringify({ error: "Failed to fetch call recording", detail: String(err) }), {
//             status: 500,
//             headers: { "Content-Type": "application/json" },
//           });
//         }
//       },
//     },
//   },
// });



import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/env";

// Proxies the call recording via Vapi's authenticated-redirect endpoint
// (GET /call/{id}/mono-recording, per
// docs.vapi.ai/security-and-privacy/retrieve-call-artifacts).
//
// IMPORTANT — do NOT fetch call.recordingUrl / call.artifact.recordingUrl
// directly. That field is an UNSIGNED path into a private R2 bucket
// (hipaa-recordings) and a direct fetch to it returns:
//   400 <Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>
// confirmed by direct testing against a real call. The bucket requires a
// signed URL regardless of the account's HIPAA setting — the mono-recording
// endpoint is what actually issues that signed URL (a 302 redirect to R2
// with a full X-Amz-Signature query string), confirmed working against the
// same real call. fetch() follows redirects by default, so hitting this
// endpoint with the Vapi auth header transparently lands on the real,
// signed audio bytes.
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

          const vapiKey = await getEnv("VAPI_PRIVATE_KEY");
          const audioRes = await fetch(
            `https://api.vapi.ai/call/${encodeURIComponent(callId)}/mono-recording`,
            {
              headers: { Authorization: `Bearer ${vapiKey || ""}` },
              redirect: "follow",
            },
          );

          if (!audioRes.ok) {
            const upstreamBody = await audioRes.text().catch(() => "");
            console.error(
              `[vapi-call-audio] mono-recording fetch returned ${audioRes.status} for call ${callId}. Body: ${upstreamBody.slice(0, 500)}`,
            );
            return new Response(
              JSON.stringify({ error: "Recording not available", upstreamStatus: audioRes.status }),
              { status: audioRes.status || 502, headers: { "Content-Type": "application/json" } },
            );
          }

          const arrayBuffer = await audioRes.arrayBuffer();
          const bytes = Buffer.from(arrayBuffer);

          if (bytes.length === 0) {
            console.error(`[vapi-call-audio] mono-recording returned 200 but an empty body for call ${callId}`);
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