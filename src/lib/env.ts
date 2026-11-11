// src/lib/env.ts
// SERVER-ONLY.
//
// Root cause this fixes: on Cloudflare Workers, `process.env.X` is not
// reliably populated from the Worker's own "Variables and Secrets" unless
// something explicitly bridges Cloudflare's env bindings into it (e.g. the
// nitro-cloudflare-dev module + unenv config) - which this project's
// vite.config.ts does not set up. Without that bridge, process.env.X is
// undefined at runtime even though the dashboard clearly shows the secret
// configured, which is exactly what caused every single API route to fail
// uniformly with things like `TypeError: Invalid URL: undefined/clients-list`.
//
// Per TanStack Start's own docs: "On Cloudflare Workers specifically, the
// canonical way to read env from anywhere is the cloudflare:workers env
// binding." That's what this helper does - it reads through that module
// directly when available (deployed Worker), and falls back to process.env
// for local dev (`bun run dev`), where cloudflare:workers doesn't exist but
// process.env is populated correctly from your local .env file.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedCfEnv: any = undefined; // undefined = not yet resolved, null = resolved-but-unavailable

async function getCloudflareEnv() {
  if (cachedCfEnv !== undefined) return cachedCfEnv;
  try {
    const specifier = "cloudflare:workers";
    const mod = await import(/* @vite-ignore */ specifier);
    cachedCfEnv = mod.env ?? null;
  } catch {
    cachedCfEnv = null;
  }
  return cachedCfEnv;
}

// Must be awaited - always call as `await getEnv("X")`, everywhere,
// including inside the shared lib/*.ts helper files.
export async function getEnv(key: string): Promise<string | undefined> {
  const cfEnv = await getCloudflareEnv();
  if (cfEnv && typeof cfEnv[key] === "string") return cfEnv[key];
  return process.env[key];
}

export async function getCloudflareBinding(key: string): Promise<unknown> {
  const cfEnv = await getCloudflareEnv();
  if (!cfEnv || typeof cfEnv !== "object") return undefined;
  return cfEnv[key];
}

/** A secret that must be configured (Cloudflare secret, or env var in tests); throws a clear error otherwise. */
export async function requireSecret(key: string): Promise<string> {
  const v = await getEnv(key);
  if (!v) throw new Error(`Missing secret ${key} (set it with: npx wrangler secret put ${key})`);
  return v;
}
