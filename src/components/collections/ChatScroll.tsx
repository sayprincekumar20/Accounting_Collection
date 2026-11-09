import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown } from "lucide-react";

/**
 * WhatsApp-style conversation scrolling: open at the LATEST message (bottom), stay at the bottom when new
 * messages arrive (unless the user scrolled up to read older ones), and offer a 'Latest' button.
 * `resetKey` = the open conversation (scroll to bottom when it changes); `count` = number of items shown.
 */
export function useChatScroll(resetKey: unknown, count: number) {
  const ref = useRef<HTMLElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const stick = useRef(true);
  const toBottom = useCallback((smooth = false) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stick.current = true;
    setAtBottom(true);
  }, []);
  // New conversation opened: jump to the latest message (again after images / layout settle).
  useLayoutEffect(() => {
    stick.current = true;
    toBottom(false);
    const t = window.setTimeout(() => toBottom(false), 150);
    return () => window.clearTimeout(t);
  }, [resetKey, toBottom]);
  // More messages loaded or a reply sent: follow them if the user was at the bottom.
  useLayoutEffect(() => {
    if (stick.current) toBottom(false);
  }, [count, toBottom]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      stick.current = near;
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [resetKey]);
  return { ref, atBottom, toBottom };
}

/** Floating 'Latest' button shown while the user reads older messages. Place inside a `relative` wrapper. */
export function LatestButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-lg hover:bg-muted"
    >
      <ArrowDown className="h-3.5 w-3.5" /> Latest
    </button>
  );
}

export type ChatScrollRef = RefObject<HTMLElement | null>;

/** Day label like WhatsApp: 'Today', 'Yesterday' or 'Mon, Nov 9, 2026' (Manila time). */
export function dayLabel(at: number): string {
  if (!at) return "";
  const manila = (t: number) => new Date(t + 8 * 3600000).toISOString().slice(0, 10);
  const d = manila(at);
  const today = manila(Date.now());
  const yesterday = manila(Date.now() - 86400000);
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(at).toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
}

/** Inserts { kind: 'day' } markers wherever the day changes in a time-sorted list. */
export function withDaySeparators<T extends { at: number }>(
  items: T[],
): (T | { kind: "day"; at: number })[] {
  const out: (T | { kind: "day"; at: number })[] = [];
  let last = "";
  for (const it of items) {
    const label = dayLabel(it.at);
    if (label && label !== last) out.push({ kind: "day", at: it.at });
    last = label;
    out.push(it);
  }
  return out;
}

/** Centred day separator between messages. */
export function DaySeparator({ at }: { at: number }) {
  return (
    <div className="my-2 flex items-center justify-center" role="separator">
      <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-semibold text-muted-foreground shadow-sm">
        {dayLabel(at)}
      </span>
    </div>
  );
}
