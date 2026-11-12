// When is the next call attempt? Grace places ONE automatic retry after an unanswered call: about 2 hours later, or
// the next working morning (9:30 AM Manila) when that would fall after the retry window. Shown as "tomorrow 9:30 AM".
const MANILA_MS = 8 * 3600000;
const shifted = (ms: number) => new Date(ms + MANILA_MS);
const dayNumber = (ms: number) => Math.floor((ms + MANILA_MS) / 86400000);

/** "today 4:15 PM", "tomorrow 9:30 AM", "Mon, Nov 16 9:30 AM" (Manila time); "" when the date is unknown. */
export function nextAttemptLabel(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const d = shifted(t);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const diff = dayNumber(t) - dayNumber(now);
  if (diff < 0 || (diff === 0 && t < now)) return `due now (${clock}), placed at the next run`;
  if (diff === 0) return `today ${clock}`;
  if (diff === 1) return `tomorrow ${clock}`;
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${date} ${clock}`;
}

/** Plain words for the call result Vapi reported. */
export function endedReasonLabel(reason: string): string {
  const r = reason.trim().toLowerCase();
  if (!r) return "";
  if (r.includes("busy")) return "line busy";
  if (r.includes("did-not-answer") || r.includes("no-answer")) return "no answer";
  if (r.includes("voicemail")) return "went to voicemail";
  if (r.includes("failed-to-connect")) return "could not connect";
  return r.replace(/-/g, " ");
}

/** The next weekly run: Wednesday 9:00 Manila (today if it is Wednesday and before 9:00). "Wed, Nov 18". */
export function nextWeeklyRunLabel(now = Date.now()): string {
  const manila = shifted(now);
  const weekday = manila.getUTCDay(); // 0 = Sunday ... 3 = Wednesday
  let add = (3 - weekday + 7) % 7;
  if (add === 0 && manila.getUTCHours() >= 9) add = 7;
  const d = new Date(
    Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate() + add),
  );
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
