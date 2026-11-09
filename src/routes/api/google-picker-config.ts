import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/lib/env";

export const Route = createFileRoute("/api/google-picker-config")({
  server: {
    handlers: {
      GET: async () => {
        const [apiKey, clientId, appId] = await Promise.all([
          getEnv("GOOGLE_PICKER_API_KEY"),
          getEnv("GOOGLE_PICKER_CLIENT_ID"),
          getEnv("GOOGLE_PICKER_APP_ID"),
        ]);
        if (!apiKey?.trim() || !clientId?.trim() || !appId?.trim()) {
          return Response.json(
            { error: "Google Drive Picker is not configured for this deployment." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        return Response.json(
          { apiKey: apiKey.trim(), clientId: clientId.trim(), appId: appId.trim() },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
