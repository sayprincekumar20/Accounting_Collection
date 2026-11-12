// Types, loader and example commands of the assistant home screen (/api/assistant/home, read-only).
export interface HomePriority {
  id: string;
  title: string;
  detail: string;
  badge: string;
  tone: "danger" | "warning" | "info" | "ok";
  prompt?: string;
}
export interface HomeHealthEvent {
  event_key: string;
  severity: string;
  title: string;
  detail: string;
  affected: string;
  suggested_fix: string;
  last_seen: string;
}
export interface HomeData {
  today: string;
  stats: {
    overdue_accounts: number | null;
    open_escalations: number | null;
    promises_due: number | null;
    workflow_issues: number | null;
  };
  detail: { health: { urgent: number; warning: number } };
  priorities: HomePriority[];
  health_events: HomeHealthEvent[];
  errors: string[];
}

export async function fetchAssistantHome(): Promise<HomeData> {
  const res = await fetch("/api/assistant/home", { cache: "no-store" });
  if (!res.ok) throw new Error(`Home unavailable (${res.status})`);
  return (await res.json()) as HomeData;
}

export const EXAMPLE_COMMANDS: { label: string; prompt: string }[] = [
  {
    label: "Analyse escalations",
    prompt:
      "Analyse the open escalations: group them by type and tell me which need AR action first.",
  },
  {
    label: "Show overdue promises",
    prompt: "Show the promises that are due today or missed, with the balance still owed.",
  },
  {
    label: "Check workflows",
    prompt: "Check the workflows and tell me what needs attention and what to do.",
  },
  { label: "Show AR reports", prompt: "List the latest AR reports." },
];
