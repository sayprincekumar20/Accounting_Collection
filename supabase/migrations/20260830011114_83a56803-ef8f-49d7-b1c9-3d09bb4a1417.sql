ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS turn_id text,
  ADD COLUMN IF NOT EXISTS notified_ar boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promise_recorded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_attachment boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS messages_turn_id_unique ON public.messages (turn_id) WHERE turn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_occurred_at_idx ON public.messages (occurred_at DESC);