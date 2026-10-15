import { createFileRoute } from "@tanstack/react-router";

// Single shared login. The form posts to /api/auth/login, which is handled in src/server.ts
// (it checks DASHBOARD_USER / DASHBOARD_PASSWORD and sets a signed session cookie).
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: search["error"] ? String(search["error"]) : undefined,
    next: typeof search["next"] === "string" ? (search["next"] as string) : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in | Rare Global Food Collections Hub" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { error, next } = Route.useSearch();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-extrabold text-primary-foreground">
            R
          </div>
          <div>
            <p className="text-sm font-extrabold uppercase tracking-[0.08em]">Rare Global Food</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Collections Hub
            </p>
          </div>
        </div>

        <form method="post" action="/api/auth/login" className="surface-card space-y-4 p-6">
          <div>
            <h1 className="text-xl font-bold">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Use the team login to open the dashboard.</p>
          </div>

          {error ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              Wrong login ID or password. Please try again.
            </p>
          ) : null}

          <input type="hidden" name="next" value={next || "/"} />

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Login ID
            </span>
            <input
              name="username"
              autoComplete="username"
              required
              autoFocus
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Password
            </span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>

          <button
            type="submit"
            className="h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
