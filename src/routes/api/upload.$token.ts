import { createFileRoute } from "@tanstack/react-router";
import { badRequest, dvEngine } from "@/lib/dv-engine";

export const TOKEN = /^[A-Za-z0-9_-]{30,64}$/;

// Upload page (no login): the checklist for this code only.
export const Route = createFileRoute("/api/upload/$token")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        TOKEN.test(params.token)
          ? dvEngine(`/public/requests/${params.token}`)
          : badRequest("This link is not valid", 404),
    },
  },
});
