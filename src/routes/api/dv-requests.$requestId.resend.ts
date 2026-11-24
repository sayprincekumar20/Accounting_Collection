import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, reviewerOf, UUID } from "@/lib/dv-engine";

// Send a document request email again (same text and link).
export const Route = createFileRoute("/api/dv-requests/$requestId/resend")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!UUID.test(params.requestId)) return badRequest("Unknown request", 404);
        const reviewer = reviewerOf(request);
        if (!reviewer) return badRequest("Enter your name before resending.");
        return dvEngine(`/v1/requests/${params.requestId}/resend`, { method: "POST" }, reviewer);
      },
    },
  },
});
