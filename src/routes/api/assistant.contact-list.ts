import { createFileRoute } from "@tanstack/react-router";
import { MAX_CONTACT, runContactList } from "@/lib/assistant/list-server";

// AI assistant contact lists, step 2: "Approve + contact" for the clients the AR team selected in the review table.
// The rules are re-checked here for every client; the approvals and the contact start immediately.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/assistant/contact-list")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const b = (await request.json()) as {
            client_ids?: unknown;
            requested_by?: unknown;
            session_id?: unknown;
            file?: unknown;
          };
          const ids = Array.isArray(b.client_ids)
            ? b.client_ids.map((x) => String(x)).filter(Boolean)
            : [];
          const who = String(b.requested_by ?? "")
            .trim()
            .slice(0, 80);
          if (!ids.length || !who)
            return json({ error: "requested_by and at least one client are required" }, 400);
          if (ids.length > MAX_CONTACT)
            return json({ error: `At most ${MAX_CONTACT} clients per confirmation.` }, 400);
          const out = await runContactList({
            clientIds: ids,
            requestedBy: who,
            sessionId: String(b.session_id ?? "").slice(0, 80),
            file: String(b.file ?? "").slice(0, 120),
          });
          return json(out, out.ok ? 200 : 422);
        } catch (err) {
          console.error("[assistant-contact-list] error:", err);
          return json(
            { error: "Failed to start the contact", detail: String(err).slice(0, 300) },
            500,
          );
        }
      },
    },
  },
});
