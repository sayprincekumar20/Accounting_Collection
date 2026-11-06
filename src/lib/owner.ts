/** CRM Account Owner full name in normal capitalisation (Zoho stores e.g. "VANESSA LHEE CORTEJOS"). */
export function ownerName(v: string | null | undefined): string {
  const s = String(v || "").trim();
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'.])([a-zà-ÿ])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}
