ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.reminder_queue REPLICA IDENTITY FULL;
ALTER TABLE public.channel_counters REPLICA IDENTITY FULL;
ALTER TABLE public.daily_run_logs REPLICA IDENTITY FULL;
ALTER TABLE public.clients REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reminder_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_counters;
ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_run_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_msg_unique
  ON public.messages (channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;