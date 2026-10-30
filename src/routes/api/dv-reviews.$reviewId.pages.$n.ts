import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, UUID } from "@/lib/dv-engine";

// Page image (JPEG) kept by the engine for the review.
export const Route = createFileRoute("/api/dv-reviews/$reviewId/pages/$n")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!UUID.test(params.reviewId) || !/^\d{1,3}$/.test(params.n)) {
          return badRequest("Unknown page", 404);
        }
        return dvEngine(`/v1/reviews/${params.reviewId}/pages/${params.n}`);
      },
    },
  },
});
