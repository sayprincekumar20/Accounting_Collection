import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit / API tests (node environment). Run: npm test
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
