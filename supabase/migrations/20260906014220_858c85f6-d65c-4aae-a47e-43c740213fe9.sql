ALTER TABLE public.reminder_queue ADD COLUMN external_id text;
CREATE UNIQUE INDEX reminder_queue_external_id_key ON public.reminder_queue (external_id) WHERE external_id IS NOT NULL;