import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Plain TanStack Start + Nitro config (no platform-specific wrapper).
// preset: "node-server" builds a standalone Node.js server (.output/server/index.mjs), run in Docker on
// Dokploy (AWS Lightsail). It listens on HOST / PORT (0.0.0.0:3000 in the Dockerfile) and serves the static
// files in .output/public itself. (Cloudflare Workers hosting was used until Nov 2026.)
export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    // Redirect the generated server entry to our own src/server.ts, which wraps
    // TanStack Start's handler with SSR error handling (see that file for why).
    nitro({
      preset: "node-server",
      plugins: ["./plugins/reply-media-cleanup.ts"],
    }),
    viteReact(),
  ],
  environments: {
    ssr: { build: { rollupOptions: { input: "./src/server.ts" } } },
  },
});
