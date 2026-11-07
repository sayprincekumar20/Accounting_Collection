import { manilaWeekday, scheduleToday } from "@/lib/schedule";

const DAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Collection Schedule (Zoho CRM) of a client, with 'Due today' / 'Next: <day>'. */
export function ScheduleLine({ value }: { value: string | null | undefined }) {
  const t = scheduleToday(value);
  const s = t.schedule;
  let badge: { text: string; cls: string };
  if (!s.configured) badge = { text: "Any day (not set)", cls: "bg-muted text-muted-foreground" };
  else if (t.eligible) badge = { text: "Due today", cls: "bg-success/12 text-success" };
  else {
    const wd = manilaWeekday();
    const next = s.days.map((d) => ({ d, k: (d - wd + 7) % 7 || 7 })).sort((a, b) => a.k - b.k)[0];
    badge = { text: `Next: ${DAY[next?.d ?? 0] ?? ""}`, cls: "bg-warning/15 text-warning" };
  }
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>Collection schedule: {s.configured ? s.label : "Not set"}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
        {badge.text}
      </span>
    </p>
  );
}
