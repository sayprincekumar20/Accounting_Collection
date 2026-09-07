ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS assistant_id text;
CREATE INDEX IF NOT EXISTS messages_assistant_id_idx ON public.messages (assistant_id);