import { createFileRoute } from "@tanstack/react-router";
import { dvEngine } from "@/lib/dv-engine";

// Document Verification > Document expiry: proxied to the engine's GET /v1/expiry.
export const Route = createFileRoute("/api/dv-expiry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const src = new URL(request.url).searchParams;
        const q = new URLSearchParams();
        for (const k of ["state", "account_id"]) {
          const v = src.get(k);
          if (v) q.set(k, v);
        }
        return dvEngine(`/v1/expiry?${q.toString()}`);
      },
    },
  },
});
