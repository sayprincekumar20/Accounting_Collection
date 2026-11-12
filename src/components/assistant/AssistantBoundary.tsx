import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "./client-error";
import { CONVERSATIONS_KEY } from "./store-key";

// Error containment for the AI assistant. A problem inside the assistant (or inside an attached list) is shown
// where it happened, with its message, and reported to the server, instead of replacing the whole dashboard with
// the "This page didn't load" screen.
interface BoundaryProps {
  where: string;
  children: ReactNode;
  fallback: (error: Error, reset: () => void) => ReactNode;
}
interface BoundaryState {
  error: Error | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[assistant:${this.props.where}]`, error);
    reportClientError(this.props.where, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  override render() {
    return this.state.error
      ? this.props.fallback(this.state.error, this.reset)
      : this.props.children;
  }
}

const detail = (e: Error) => `${e.name}: ${e.message}`.slice(0, 400);

/** Around the whole assistant (floating button and panel). */
export function AssistantBoundary({ children }: { children: ReactNode }) {
  return (
    <Boundary
      where="assistant"
      fallback={(error, reset) => (
        <div
          role="alert"
          className="fixed bottom-5 right-5 z-50 w-[min(420px,calc(100vw-40px))] rounded-2xl border border-border bg-background p-4 shadow-2xl"
        >
          <p className="text-sm font-semibold">The assistant stopped working</p>
          <p className="mt-1 text-xs text-muted-foreground">
            It was switched off so the rest of the dashboard keeps working. The problem was
            reported.
          </p>
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">
            {detail(error)}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              Restart the assistant
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem(CONVERSATIONS_KEY);
                } catch {
                  // storage unavailable
                }
                reset();
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
            >
              Clear saved conversations and restart
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </Boundary>
  );
}

/** Around one attached list (sheet picker or review table) inside a conversation. */
export function ListBoundary({ children }: { children: ReactNode }) {
  return (
    <Boundary
      where="list"
      fallback={(error, reset) => (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs"
        >
          <p className="font-semibold text-destructive">This list could not be displayed.</p>
          <p className="mt-1 text-muted-foreground">
            Nothing was sent. The rest of the assistant still works; attach the file again to retry.
            The problem was reported.
          </p>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">
            {detail(error)}
          </pre>
          <button
            type="button"
            onClick={reset}
            className="mt-2 rounded-md border border-border px-2 py-1 font-semibold"
          >
            Try again
          </button>
        </div>
      )}
    >
      {children}
    </Boundary>
  );
}
