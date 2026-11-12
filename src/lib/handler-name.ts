// The name of the person using the dashboard (recorded with their actions). Asked once per browser tab,
// shared with the worklist, approvals and assistant (same sessionStorage key).
const KEY = "rgf-handler-name";

export function getHandlerName(): string {
  if (typeof window === "undefined") return "";
  let n = sessionStorage.getItem(KEY) || "";
  if (!n) {
    n = (window.prompt("Your name (recorded with this action):") || "").trim().slice(0, 80);
    if (n) sessionStorage.setItem(KEY, n);
  }
  return n;
}
