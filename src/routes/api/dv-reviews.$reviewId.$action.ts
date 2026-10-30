import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, reviewerOf, UUID } from "@/lib/dv-engine";

// Reviewer actions: start | approve | reject | request-documents (who acts: X-Reviewer).
const ACTIONS = new Set(["start", "approve", "reject", "request-documents"]);

export const Route = createFileRoute("/api/dv-reviews/$reviewId/$action")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!UUID.test(params.reviewId) || !ACTIONS.has(params.action)) {
          return badRequest("Unknown review action", 404);
        }
        const reviewer = reviewerOf(request);
        if (!reviewer) return badRequest("Enter your name before acting on a review.");
        const body = params.action === "start" ? "" : await request.text();
        const init: RequestInit = body ? { method: "POST", body } : { method: "POST" };
        return dvEngine(`/v1/reviews/${params.reviewId}/${params.action}`, init, reviewer);
      },
    },
  },
});
