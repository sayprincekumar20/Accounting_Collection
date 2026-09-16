import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Plain TanStack Start + Nitro config (no platform-specific wrapper).
// preset: "cloudflare-module" builds a Cloudflare Workers-compatible bundle.
// Switch back to "node-server" if you ever return to Render, or "vercel" for Vercel.
export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    // Redirect the generated server entry to our own src/server.ts, which wraps
    // TanStack Start's handler with SSR error handling (see that file for why).
    nitro({ preset: "cloudflare-module" }),
    viteReact(),
  ],
  environments: {
    ssr: { build: { rollupOptions: { input: "./src/server.ts" } } },
  },
});
