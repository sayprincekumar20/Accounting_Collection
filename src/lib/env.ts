// src/lib/env.ts
// SERVER-ONLY.
//
// Every secret and setting is read from the process environment (Dokploy > Environment in production,
// a local .env file in development). Kept async so existing call sites (`await getEnv("X")`) work unchanged.
// (Until Nov 2026 the app was hosted on Workers and read secrets through a platform binding.)

// Must be awaited - always call as `await getEnv("X")`, everywhere,
// including inside the shared lib/*.ts helper files.
export async function getEnv(key: string): Promise<string | undefined> {
  return process.env[key];
}

/** A secret that must be configured (server environment, or env var in tests); throws a clear error otherwise. */
export async function requireSecret(key: string): Promise<string> {
  const v = await getEnv(key);
  if (!v)
    throw new Error(
      `Missing secret ${key} (set it in the server environment, e.g. Dokploy > Environment)`,
    );
  return v;
}
