-- Allow n8n to upsert reminder_queue rows idempotently, one row per client per day,
-- matching the same (client + day) pattern already used for channel_counters.
ALTER TABLE public.reminder_queue
  ADD CONSTRAINT reminder_queue_client_date_unique UNIQUE (client_id, created_date);
