DROP INDEX IF EXISTS public.messages_provider_msg_unique;
CREATE UNIQUE INDEX messages_provider_msg_unique ON public.messages (channel, provider_message_id);