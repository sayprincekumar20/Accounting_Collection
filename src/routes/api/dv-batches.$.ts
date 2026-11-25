import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, reviewerOf } from "@/lib/dv-engine";

// Batch check, everything below /api/dv-batches/: only these paths reach the engine.
const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const GET_PATHS = [new RegExp(`^${ID}$`), /^channels$/];
const POST_PATHS = [
  new RegExp(`^${ID}/(pause|resume|complete)$`),
  new RegExp(`^${ID}/items/${ID}/retry$`),
  new RegExp(`^spot-check/${ID}$`),
];

export const Route = createFileRoute("/api/dv-batches/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const path = params._splat || "";
        if (path === "overview") {
          const channel = new URL(request.url).searchParams.get("channel") || "";
          if (!channel || channel.length > 120) return badRequest("Choose a channel");
          return dvEngine(`/v1/batches/overview?channel=${encodeURIComponent(channel)}`);
        }
        if (!GET_PATHS.some((r) => r.test(path))) return badRequest("Not found", 404);
        return dvEngine(`/v1/batches/${path}`);
      },
      POST: async ({ request, params }) => {
        const path = params._splat || "";
        if (!POST_PATHS.some((r) => r.test(path))) return badRequest("Not found", 404);
        const reviewer = reviewerOf(request);
        if (!reviewer) return badRequest("Enter your name first.");
        const body = await request.text();
        return dvEngine(
          `/v1/batches/${path}`,
          { method: "POST", ...(body ? { body } : {}) },
          reviewer,
        );
      },
    },
  },
});
