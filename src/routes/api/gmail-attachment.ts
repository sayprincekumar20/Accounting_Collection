import { createFileRoute } from "@tanstack/react-router";
import { getAccessToken, gmailFetch } from "@/lib/gmail-server";

// Fetches a Gmail attachment's actual bytes (PDF, image, etc.) so it can be
// opened/downloaded from the dashboard. Gmail's attachment API is scoped per
// message: GET /messages/{messageId}/attachments/{attachmentId}, returning
// base64url-encoded data - no separate scope needed beyond gmail.readonly.

export const Route = createFileRoute("/api/gmail-attachment")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const messageId = url.searchParams.get("messageId");
          const attachmentId = url.searchParams.get("attachmentId");
          const filename = url.searchParams.get("filename") || "attachment";
          const mimeType = url.searchParams.get("mimeType") || "application/octet-stream";

          if (!messageId || !attachmentId) {
            return new Response(JSON.stringify({ error: "messageId and attachmentId are required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const accessToken = await getAccessToken();
          const result = await gmailFetch<{ data: string; size: number }>(
            `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
            accessToken,
          );

          const bytes = Buffer.from(result.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");

          return new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": mimeType,
              // "inline" so PDFs open in a new browser tab instead of forcing a download
              "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
              "Content-Length": String(bytes.length),
              "Cache-Control": "private, max-age=3600",
            },
          });
        } catch (err) {
          console.error("[gmail-attachment] fetch error:", err);
          return new Response(JSON.stringify({ error: "Failed to fetch attachment" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
