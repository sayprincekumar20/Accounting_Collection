import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine } from "@/lib/dv-engine";
import { TOKEN } from "@/routes/api/upload.$token";

// Upload page (no login): all files uploaded, verify the account again.
export const Route = createFileRoute("/api/upload/$token/submit")({
  server: {
    handlers: {
      POST: async ({ params }) =>
        TOKEN.test(params.token)
          ? dvEngine(`/public/requests/${params.token}/submit`, { method: "POST" })
          : badRequest("This link is not valid", 404),
    },
  },
});
