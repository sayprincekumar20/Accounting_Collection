import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine } from "@/lib/dv-engine";
import { TOKEN } from "@/routes/api/upload.$token";

// Upload page (no login): one file for one document, passed to the engine as received.
export const Route = createFileRoute("/api/upload/$token/files")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!TOKEN.test(params.token)) return badRequest("This link is not valid", 404);
        const type = request.headers.get("content-type") || "";
        if (!type.startsWith("multipart/form-data")) return badRequest("Send the file as a form");
        const length = Number(request.headers.get("content-length") || 0);
        if (length > 26 * 1024 * 1024) return badRequest("The file is larger than 25 MB", 413);
        return dvEngine(`/public/requests/${params.token}/files`, {
          method: "POST",
          body: await request.arrayBuffer(),
          headers: { "Content-Type": type },
        });
      },
    },
  },
});
