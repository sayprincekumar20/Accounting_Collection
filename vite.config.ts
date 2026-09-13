import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Plain TanStack Start + Nitro config (no platform-specific wrapper).
// preset: "node-server" builds a native Node.js server - the format Render
// (and most non-serverless hosts) expects. Switch this if you ever deploy
// elsewhere: "cloudflare-module" for Cloudflare Workers, "vercel" for Vercel, etc.
export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    // Redirect the generated server entry to our own src/server.ts, which wraps
    // TanStack Start's handler with SSR error handling (see that file for why).
    nitro({ preset: "node-server" }),
    viteReact(),
  ],
  environments: {
    ssr: { build: { rollupOptions: { input: "./src/server.ts" } } },
  },
});
