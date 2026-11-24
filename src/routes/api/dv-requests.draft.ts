import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine, reviewerOf } from "@/lib/dv-engine";

// Pre-filled request email (Account Owner or customer) with the documents needed.
export const Route = createFileRoute("/api/dv-requests/draft")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const src = new URL(request.url).searchParams;
        const account = src.get("account_id") || "";
        if (!/^\d{5,25}$/.test(account)) return badRequest("Unknown account", 404);
        const q = new URLSearchParams({ account_id: account });
        const recipient = src.get("recipient");
        if (recipient === "customer" || recipient === "owner") q.set("recipient", recipient);
        const docs = src.get("documents");
        if (docs && /^[A-Z0-9_,]{1,200}$/.test(docs)) q.set("documents", docs);
        return dvEngine(`/v1/requests/draft?${q.toString()}`, {}, reviewerOf(request));
      },
    },
  },
});
