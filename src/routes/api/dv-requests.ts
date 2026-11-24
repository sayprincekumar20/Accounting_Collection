import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, reviewerOf } from "@/lib/dv-engine";

// Document requests: GET list (account_id), POST send the edited email with the upload link.
export const Route = createFileRoute("/api/dv-requests")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const account = new URL(request.url).searchParams.get("account_id");
        const q = account && /^\d{5,25}$/.test(account) ? `?account_id=${account}` : "";
        return dvEngine(`/v1/requests${q}`);
      },
      POST: async ({ request }) => {
        const reviewer = reviewerOf(request);
        if (!reviewer) return badRequest("Enter your name before sending a request.");
        return dvEngine("/v1/requests", { method: "POST", body: await request.text() }, reviewer);
      },
    },
  },
});
