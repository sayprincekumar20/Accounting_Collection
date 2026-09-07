DROP INDEX IF EXISTS public.messages_turn_id_unique;
CREATE UNIQUE INDEX messages_turn_id_unique ON public.messages (turn_id);