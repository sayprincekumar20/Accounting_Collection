import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, UUID } from "@/lib/dv-engine";

// One review: summary texts, activation checks, proposed changes, page list.
export const Route = createFileRoute("/api/dv-reviews/$reviewId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!UUID.test(params.reviewId)) return badRequest("Unknown review", 404);
        return dvEngine(`/v1/reviews/${params.reviewId}`);
      },
    },
  },
});
