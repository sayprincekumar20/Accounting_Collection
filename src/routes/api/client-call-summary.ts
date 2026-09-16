import { getEnv } from "@/lib/env";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/client-call-summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const clientId = url.searchParams.get("clientId");
          if (!clientId) {
            return new Response(JSON.stringify({ error: "clientId is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const res = await fetch(
            `${await getEnv("N8N_WEBHOOK_BASE_URL")}/client-call-summary?clientId=${encodeURIComponent(clientId)}`,
          );
          
          // If 404, return empty summary instead of error
          if (res.status === 404) {
            return new Response(JSON.stringify({ 
              clientId,
              clientName: "",
              totalCalls: 0,
              connectedCalls: 0,
              failedCalls: 0,
              totalDuration: 0,
              lastCallDate: "",
              hasEscalations: false,
              escalationCount: 0,
              hasPromises: false,
              promiseCount: 0
            }), {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            });
          }
          
          const body = await res.text();
          return new Response(body, {
            status: res.status,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch (err) {
          console.error("[client-call-summary] fetch error:", err);
          return new Response(JSON.stringify({ 
            clientId: "",
            clientName: "",
            totalCalls: 0,
            connectedCalls: 0,
            failedCalls: 0,
            totalDuration: 0,
            lastCallDate: "",
            hasEscalations: false,
            escalationCount: 0,
            hasPromises: false,
            promiseCount: 0
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
