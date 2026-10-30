import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, reviewerOf, UUID } from "@/lib/dv-engine";

// Decision on one proposed change: Approve | Edit (with value) | Reject | Pending.
export const Route = createFileRoute("/api/dv-reviews/$reviewId/rows/$rowId")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        if (!UUID.test(params.reviewId) || !/^\d{1,4}$/.test(params.rowId)) {
          return badRequest("Unknown row", 404);
        }
        const reviewer = reviewerOf(request);
        if (!reviewer) return badRequest("Enter your name before deciding.");
        return dvEngine(
          `/v1/reviews/${params.reviewId}/rows/${params.rowId}`,
          { method: "PUT", body: await request.text() },
          reviewer,
        );
      },
    },
  },
});
