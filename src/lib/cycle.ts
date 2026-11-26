// The weekly cycle starts Wednesday 00:00 Manila. Pure (no server code), usable in pages and on the server.
export function cycleStart(now: Date = new Date()): Date {
  const manila = new Date(now.getTime() + 8 * 3600000);
  const back = (manila.getUTCDay() - 3 + 7) % 7; // 3 = Wednesday
  return new Date(
    Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate() - back) -
      8 * 3600000,
  );
}
