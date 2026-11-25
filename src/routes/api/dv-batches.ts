import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, reviewerOf } from "@/lib/dv-engine";

// Batch check: GET list of batches, POST start a batch (channel, size).
export const Route = createFileRoute("/api/dv-batches")({
  server: {
    handlers: {
      GET: async () => dvEngine("/v1/batches"),
      POST: async ({ request }) => {
        const reviewer = reviewerOf(request);
        if (!reviewer) return badRequest("Enter your name before starting a batch.");
        return dvEngine("/v1/batches", { method: "POST", body: await request.text() }, reviewer);
      },
    },
  },
});
