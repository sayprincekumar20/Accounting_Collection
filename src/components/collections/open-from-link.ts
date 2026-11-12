import { useEffect, useRef } from "react";

// Channel pages accept ?open=<value> (a phone number on Viber / SMS / WhatsApp, a thread id on Email): once the
// list has loaded, the matching conversation opens by itself. Used by the "Contact" button on Clients.
export function useOpenFromLink(ready: boolean, open: (value: string) => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready || typeof window === "undefined") return;
    done.current = true;
    const value = new URLSearchParams(window.location.search).get("open");
    if (value) open(value);
  }, [ready, open]);
}
