import { createFileRoute } from "@tanstack/react-router";
import { dvEngine } from "@/lib/dv-engine";

// Document Verification tab: list of reviews (proxied to the engine's GET /v1/reviews).
export const Route = createFileRoute("/api/dv-reviews")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const src = new URL(request.url).searchParams;
        const q = new URLSearchParams();
        for (const k of ["status", "account_id", "limit", "offset"]) {
          const v = src.get(k);
          if (v) q.set(k, v);
        }
        return dvEngine(`/v1/reviews?${q.toString()}`);
      },
    },
  },
});
