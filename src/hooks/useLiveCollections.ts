import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const TABLES = [
  "messages",
  "reminder_queue",
  "channel_counters",
  "daily_run_logs",
  "clients",
] as const;

export type LiveStatus = "connecting" | "live" | "offline";

/**
 * Subscribes once to realtime changes on the collections tables and
 * invalidates the matching React Query caches so the dashboard updates
 * the instant n8n writes a row (any channel: WhatsApp, Viber, SMS, Email, Voice).
 */
export function useLiveCollections() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    const channel = supabase.channel("collections-live");

    for (const table of TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          queryClient.invalidateQueries({ queryKey: [table] });
          setLastEventAt(new Date());
          setEventCount((n) => n + 1);
        },
      );
    }

    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") setStatus("live");
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED")
        setStatus("offline");
      else setStatus("connecting");
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return { status, lastEventAt, eventCount };
}
