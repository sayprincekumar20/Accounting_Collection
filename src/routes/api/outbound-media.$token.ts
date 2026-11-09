import { createFileRoute } from "@tanstack/react-router";
import { getStoredReplyMedia, isReplyMediaId } from "@/lib/reply-media";

async function serveReplyMedia(token: string, method: "GET" | "HEAD") {
  if (!isReplyMediaId(token)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const object = await getStoredReplyMedia(token);
    if (!object?.body) return new Response("Not found or expired", { status: 404 });
    const filename = encodeURIComponent(object.filename).replace(/'/g, "%27");
    const headers = new Headers({
      "Content-Type": object.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    if (method === "HEAD") headers.set("Content-Length", String(object.size));
    return new Response(method === "HEAD" ? null : object.body, { headers });
  } catch (error) {
    console.error("[outbound-media] read failed:", error);
    return new Response("Media unavailable", { status: 503 });
  }
}

export const Route = createFileRoute("/api/outbound-media/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => serveReplyMedia(params.token, "GET"),
      HEAD: async ({ params }) => serveReplyMedia(params.token, "HEAD"),
    },
  },
});
