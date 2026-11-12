// Reports an error of the assistant's screen to the dashboard server (saved in the assistant audit log), so the
// exact message can be read even when the person only saw "something went wrong". Never throws.
const sent = new Set<string>();

export function reportClientError(
  where: string,
  error: unknown,
  componentStack?: string | null,
): void {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const key = `${where}|${e.message}`;
    if (sent.has(key) || sent.size > 20) return;
    sent.add(key);
    void fetch("/api/assistant/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        where,
        name: e.name,
        message: e.message,
        stack: e.stack ?? "",
        component_stack: componentStack ?? "",
        page: typeof location === "undefined" ? "" : location.pathname,
        agent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      }),
    }).catch(() => {});
  } catch {
    // reporting must never cause another error
  }
}
