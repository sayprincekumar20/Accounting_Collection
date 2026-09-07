
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  client_name text NOT NULL,
  parent_name text,
  email text,
  phone text,
  viber_available boolean NOT NULL DEFAULT false,
  whatsapp_available boolean NOT NULL DEFAULT false,
  gmail_available boolean NOT NULL DEFAULT false,
  messenger_available boolean NOT NULL DEFAULT false,
  sms_available boolean NOT NULL DEFAULT false,
  voice_available boolean NOT NULL DEFAULT false,
  collection_amount numeric NOT NULL DEFAULT 0,
  due_date date,
  status text NOT NULL DEFAULT 'overdue',
  invoice_numbers text,
  branches text,
  ar_owner text,
  credit_terms text,
  credit_limit numeric,
  source text,
  suppression_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.clients TO anon;
GRANT SELECT ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients are publicly readable" ON public.clients FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  channel text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  provider text,
  provider_message_id text,
  subject text,
  body text,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  is_fallback boolean NOT NULL DEFAULT false,
  duration_seconds integer,
  recording_url text,
  transcript text,
  agent_name text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_client_idx ON public.messages (client_id, occurred_at DESC);
CREATE INDEX messages_channel_idx ON public.messages (channel, occurred_at DESC);
GRANT SELECT ON public.messages TO anon;
GRANT SELECT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Messages are publicly readable" ON public.messages FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.reminder_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name text,
  preferred_channel text NOT NULL,
  queue_status text NOT NULL DEFAULT 'pending',
  fallback_channel text,
  fallback_status text,
  collection_amount numeric NOT NULL DEFAULT 0,
  due_date date,
  invoice_numbers text,
  created_date date NOT NULL DEFAULT current_date,
  attempted_date timestamptz,
  sent_date timestamptz,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reminder_queue TO anon;
GRANT SELECT ON public.reminder_queue TO authenticated;
GRANT ALL ON public.reminder_queue TO service_role;
ALTER TABLE public.reminder_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Queue is publicly readable" ON public.reminder_queue FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.channel_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  date date NOT NULL DEFAULT current_date,
  sent_count integer NOT NULL DEFAULT 0,
  daily_limit integer NOT NULL DEFAULT 250,
  last_updated timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, date)
);
GRANT SELECT ON public.channel_counters TO anon;
GRANT SELECT ON public.channel_counters TO authenticated;
GRANT ALL ON public.channel_counters TO service_role;
ALTER TABLE public.channel_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Counters are publicly readable" ON public.channel_counters FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.daily_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL UNIQUE,
  run_timestamp timestamptz NOT NULL DEFAULT now(),
  total_processed integer NOT NULL DEFAULT 0,
  total_outstanding numeric NOT NULL DEFAULT 0,
  viber_queued integer NOT NULL DEFAULT 0,
  email_queued integer NOT NULL DEFAULT 0,
  whatsapp_queued integer NOT NULL DEFAULT 0,
  sms_queued integer NOT NULL DEFAULT 0,
  voice_queued integer NOT NULL DEFAULT 0,
  no_contact_count integer NOT NULL DEFAULT 0,
  no_contact_amount numeric NOT NULL DEFAULT 0,
  email_only_count integer NOT NULL DEFAULT 0,
  email_only_amount numeric NOT NULL DEFAULT 0,
  skipped_cooldown integer NOT NULL DEFAULT 0,
  summary_text text
);
GRANT SELECT ON public.daily_run_logs TO anon;
GRANT SELECT ON public.daily_run_logs TO authenticated;
GRANT ALL ON public.daily_run_logs TO service_role;
ALTER TABLE public.daily_run_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Run logs are publicly readable" ON public.daily_run_logs FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.clients (external_id, client_name, parent_name, email, phone, viber_available, whatsapp_available, gmail_available, sms_available, voice_available, collection_amount, due_date, status, invoice_numbers, branches, ar_owner, credit_terms, credit_limit, source) VALUES
('C00010','Jed Gatmaitan','Rare Global Food','jed@rareglobalfood.com','+639178250801', false, false, true, false, false, 35385.39, '2026-08-02','email_only','NBA DR 4481, DR 4499, DR 16898, INV-23374, DR 14527, DR 14634, DR 14783, DR 14913, DR 14962, DR 15371, DR 15717, DR 15839','Main','Joshua Lee','30 days', 100000, 'Business Central sync'),
('C00011','Casa Marino Bistro','Casa Marino Group','ar@casamarino.ph','+639178250898', true, true, true, true, true, 48200.00, '2026-08-05','overdue','INV-23401, INV-23455','Makati, BGC','Joshua Lee','30 days', 150000, 'Business Central sync'),
('C00012','Golden Wok Commissary','Golden Wok Inc','finance@goldenwok.ph','+639175551020', true, false, true, true, true, 26750.50, '2026-08-08','promise_to_pay','INV-23388','Pasig','Denise Reyes','15 days', 80000, 'Business Central sync'),
('C00013','Pampanga Grill House',NULL,'ramon@pampangagrill.ph','+639189992244', false, true, false, true, true, 18900.00, '2026-08-11','overdue','DR 16920, DR 16988','Pampanga','Ramon Dela Cruz','7 days', 50000, 'Manual entry'),
('C00014','Seaside Hotel Kitchen','Seaside Hospitality','procurement@seasidehotel.ph','+639173338877', true, true, true, true, false, 62400.00, '2026-07-29','escalated','INV-23310, INV-23344, DR 15901','Cebu, Mactan','Joshua Lee','45 days', 250000, 'Business Central sync'),
('C00015','Barrio Fiesta Paranaque','Barrio Group',NULL,NULL, false, false, false, false, false, 22500.00, '2026-08-03','no_contact','DR 15550','Paranaque','Denise Reyes','30 days', 60000, 'Business Central sync'),
('C00016','Lutong Bahay Catering',NULL,NULL,NULL, false, false, false, false, false, 22500.00, '2026-08-04','no_contact','DR 15612','Quezon City','Denise Reyes','30 days', 60000, 'Manual entry');

INSERT INTO public.messages (client_id, channel, direction, provider, subject, body, status, occurred_at, duration_seconds, transcript, agent_name)
SELECT c.id, m.channel, m.direction, m.provider, m.subject, m.body, m.status, m.occurred_at, m.duration_seconds, m.transcript, m.agent_name
FROM (VALUES
 ('C00011','whatsapp','outbound','twilio', NULL, 'Good day Casa Marino! This is Rare Global Food. Your account has an outstanding balance of PHP 48,200.00 covering INV-23401 and INV-23455, due 05 Aug 2026. May we know the schedule of payment?', 'delivered', now() - interval '3 days 4 hours', NULL, NULL, NULL),
 ('C00011','whatsapp','inbound','twilio', NULL, 'Hi! Checking with accounting. We usually release payments every Friday.', 'received', now() - interval '3 days 3 hours', NULL, NULL, NULL),
 ('C00011','whatsapp','outbound','twilio', NULL, 'Thank you! We will note Friday 28 Aug as the target release date. Statement of account attached for your reference.', 'read', now() - interval '3 days 2 hours', NULL, NULL, NULL),
 ('C00011','whatsapp','inbound','twilio', NULL, 'Noted. Please send the SOA to ar@casamarino.ph as well.', 'received', now() - interval '2 days 20 hours', NULL, NULL, NULL),
 ('C00011','email','outbound','gmail','Statement of Account - Casa Marino Bistro (PHP 48,200.00)','Dear Casa Marino team, Please find attached your statement of account covering INV-23401 and INV-23455. Kindly confirm the payment schedule.','sent', now() - interval '2 days 19 hours', NULL, NULL, NULL),
 ('C00011','email','inbound','gmail','Re: Statement of Account - Casa Marino Bistro','Received, thank you. Payment will be released on Friday via bank transfer.','received', now() - interval '2 days 6 hours', NULL, NULL, NULL),
 ('C00012','viber','outbound','telerivet', NULL, 'Hello Golden Wok! Friendly reminder: PHP 26,750.50 (INV-23388) was due 08 Aug 2026. Please advise on payment.', 'delivered', now() - interval '5 days', NULL, NULL, NULL),
 ('C00012','viber','inbound','telerivet', NULL, 'We are processing it, check will be ready on the 30th.', 'received', now() - interval '4 days 22 hours', NULL, NULL, NULL),
 ('C00012','sms','outbound','telerivet', NULL, 'RARE GLOBAL FOOD: Reminder - PHP 26,750.50 overdue (INV-23388). Reply PAID once settled. Thank you.', 'delivered', now() - interval '2 days', NULL, NULL, NULL),
 ('C00012','voice','outbound','vapi', NULL, 'AI collections call - promise to pay captured', 'completed', now() - interval '1 day 3 hours', 92, 'Agent: Hello, this is Rare Global Food calling about invoice INV-23388. Customer: Yes, the check is ready on the 30th. Agent: Thank you, we have noted 30 August as your promise to pay.', 'Rare AR Voice Agent'),
 ('C00013','sms','outbound','telerivet', NULL, 'RARE GLOBAL FOOD: PHP 18,900.00 is past due (DR 16920, DR 16988). Please settle or reply for a payment plan.', 'delivered', now() - interval '6 days', NULL, NULL, NULL),
 ('C00013','sms','inbound','telerivet', NULL, 'Sino po ito? Ipapasa ko sa may-ari.', 'received', now() - interval '6 days' + interval '40 minutes', NULL, NULL, NULL),
 ('C00013','whatsapp','outbound','twilio', NULL, 'Good day Sir Ramon, this is Rare Global Food AR team regarding DR 16920 and DR 16988 totalling PHP 18,900.00.', 'sent', now() - interval '2 days 5 hours', NULL, NULL, NULL),
 ('C00013','voice','outbound','elevenlabs', NULL, 'Voice reminder call - no answer', 'no_answer', now() - interval '1 day', 0, NULL, 'Rare AR Voice Agent'),
 ('C00014','email','outbound','gmail','Overdue Notice - Seaside Hotel Kitchen (PHP 62,400.00)','Dear Procurement, our records show PHP 62,400.00 remains unpaid past 29 July 2026 across INV-23310, INV-23344 and DR 15901. Please advise urgently.','sent', now() - interval '8 days', NULL, NULL, NULL),
 ('C00014','email','inbound','gmail','Re: Overdue Notice - Seaside Hotel Kitchen','Kindly resend the supporting delivery receipts, we cannot process without them.','received', now() - interval '7 days 12 hours', NULL, NULL, NULL),
 ('C00014','viber','outbound','telerivet', NULL, 'Hi Seaside team, delivery receipts have been emailed. Balance PHP 62,400.00 is now 30 days past due.', 'delivered', now() - interval '4 days', NULL, NULL, NULL),
 ('C00014','voice','outbound','elevenlabs', NULL, 'Escalation call to procurement officer', 'completed', now() - interval '20 hours', 148, 'Agent: We are following up on three overdue invoices. Customer: Documents received, we will schedule payment next week. Agent: Thank you, noted for 03 September.', 'Rare AR Voice Agent'),
 ('C00010','email','outbound','gmail','Daily Overdue Reminder - PHP 35,385.39','Email sent - please also follow up by phone. Invoices: NBA DR 4481, DR 4499, DR 16898, INV-23374 and 8 more.','sent', now() - interval '11 days', NULL, NULL, NULL),
 ('C00010','email','outbound','gmail','Follow-up: Overdue balance PHP 35,385.39','Second reminder. No phone or messaging channel is on file for this account.','sent', now() - interval '4 days', NULL, NULL, NULL)
) AS m(ext, channel, direction, provider, subject, body, status, occurred_at, duration_seconds, transcript, agent_name)
JOIN public.clients c ON c.external_id = m.ext;

INSERT INTO public.reminder_queue (client_id, client_name, preferred_channel, queue_status, fallback_channel, fallback_status, collection_amount, due_date, invoice_numbers, created_date, attempted_date, sent_date, source)
SELECT c.id, c.client_name, q.pref, q.st, q.fb, q.fbs, c.collection_amount, c.due_date, c.invoice_numbers, current_date, q.att, q.snt, 'n8n daily run'
FROM (VALUES
 ('C00011','whatsapp','sent','viber','not_needed', now() - interval '3 days 4 hours', now() - interval '3 days 4 hours'),
 ('C00012','viber','sent','sms','sent', now() - interval '5 days', now() - interval '5 days'),
 ('C00013','sms','sent','whatsapp','sent', now() - interval '6 days', now() - interval '6 days'),
 ('C00014','email','sent','viber','sent', now() - interval '8 days', now() - interval '8 days'),
 ('C00010','email','sent',NULL,NULL, now() - interval '4 days', now() - interval '4 days'),
 ('C00015','none','no_contact',NULL,NULL, NULL, NULL),
 ('C00016','none','no_contact',NULL,NULL, NULL, NULL)
) AS q(ext, pref, st, fb, fbs, att, snt)
JOIN public.clients c ON c.external_id = q.ext;

INSERT INTO public.channel_counters (channel, date, sent_count, daily_limit) VALUES
('whatsapp', current_date, 42, 250),
('viber', current_date, 28, 200),
('sms', current_date, 65, 500),
('email', current_date, 51, 1000),
('voice', current_date, 12, 60);

INSERT INTO public.daily_run_logs (run_date, total_processed, total_outstanding, viber_queued, email_queued, whatsapp_queued, sms_queued, voice_queued, no_contact_count, no_contact_amount, email_only_count, email_only_amount, skipped_cooldown, summary_text)
SELECT d::date, 12, 150000, 3, 5, 2, 2, 1, 2, 45000, 2, 30000, 1,
  'Daily Overdue Report - ' || to_char(d, 'FMMonth DD, YYYY') || E'\n\nTotal Processed: 12\nTotal Outstanding: PHP 150000\nViber Queued: 3\nEmail Queued: 5\nNo Contact: 2 (PHP 45000)\nEmail Only: 2 (PHP 30000)'
FROM generate_series(current_date - interval '11 days', current_date, interval '1 day') AS d;
