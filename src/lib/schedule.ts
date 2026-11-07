// Collection Schedule (Zoho CRM Accounts.Collection_Schedule, multi-select: Any Day, Monday ... Friday).
// The SAME function is used in n8n (02 queue builder, 03 call pump, 31 pre-send refresh); keep them in sync.
//   - listed days: eligible only on those days (priority 1 on a matching day)
//   - Any Day (also "Any Days", "anyday", "any"): eligible every day (priority 2)
//   - empty / NULL / unreadable: eligible, but only remaining slots (priority 3)
export interface Schedule {
  any: boolean;
  days: number[]; // ISO weekday 1 = Monday ... 7 = Sunday
  configured: boolean;
  label: string; // "Any Day" | "Monday, Friday" | ""
}

const DAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function parseSchedule(value: unknown): Schedule {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  const tokens = raw
    .toLowerCase()
    .replace(/[[\]"']/g, " ")
    .split(/[,;/|&]+|\s+and\s+/)
    .flatMap((t) => (/^\s*any\s*days?\s*$/.test(t) ? [t] : t.split(/\s+/)))
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter(Boolean);
  let any = false;
  const days = new Set<number>();
  const map: Record<string, number> = {
    mon: 1,
    tue: 2,
    tues: 2,
    wed: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    fri: 5,
    sat: 6,
    sun: 7,
  };
  for (const t of tokens) {
    if (/^any(day|days)?$/.test(t)) {
      any = true;
      continue;
    }
    const key = Object.keys(map).find(
      (k) =>
        t === k ||
        (t.startsWith(k) && t.length >= 3 && DAY_NAMES[map[k]!]!.toLowerCase().startsWith(t)),
    );
    if (key) days.add(map[key]!);
  }
  const sorted = [...days].sort((a, b) => a - b);
  return {
    any,
    days: any ? [] : sorted,
    configured: any || sorted.length > 0,
    label: any ? "Any Day" : sorted.map((d) => DAY_NAMES[d]).join(", "),
  };
}

/** ISO weekday (1 = Monday) of `now` in Manila (UTC+8). */
export function manilaWeekday(now: Date = new Date()): number {
  const d = new Date(now.getTime() + 8 * 3600000).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Eligible today, and its priority: 1 = listed day matches, 2 = Any Day, 3 = no schedule; 0 = not eligible. */
export function scheduleToday(
  value: unknown,
  now: Date = new Date(),
): { eligible: boolean; priority: 0 | 1 | 2 | 3; schedule: Schedule } {
  const s = parseSchedule(value);
  if (!s.configured) return { eligible: true, priority: 3, schedule: s };
  if (s.any) return { eligible: true, priority: 2, schedule: s };
  return s.days.includes(manilaWeekday(now))
    ? { eligible: true, priority: 1, schedule: s }
    : { eligible: false, priority: 0, schedule: s };
}
