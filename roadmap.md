# Roadmap

- [x] Email tab returned to Channel Inboxes group in sidebar
- [x] Email tab restyled to match SMS inbox layout (stat cards + threads + thread panel)
- [x] Vapi AI voice call logs synced into Voice inbox (`/api/public/vapi-import` pull + `/api/public/vapi-webhook` realtime end-of-call)
- [x] Fixed wrong default `project_id` in `/api/public/telerivet-import` (was `0c188306`, should be the full `PJ0c188306515689f8`)
- [x] SMS inbox redesigned to match Voice's table + slide-in drawer pattern (was: always-visible side panel)
- [x] Fixed deeper bug in n8n-conversation.ts: channel_available flags only set once at first contact, never updated afterward - fixed so any channel a client is actually reached on gets flagged true
- [x] Added `reminder_queue` payload type + handler to n8n-logs.ts, with a unique constraint migration for idempotent upserts
- [x] Wired real n8n pushes for daily_run (00C, reusing already-computed Daily Run Log data), reminder_queue (00C, per client), and channel_counter (new scheduled workflow, every 30 min) - these 3 dashboard data sources had never received data before this
- [ ] Blocked on the real Lovable production URL - all 3 new n8n push nodes have a placeholder URL (`PASTE_REAL_LOVABLE_APP_URL_HERE`) that needs to be replaced with the actual deployed app URL before these pushes will work
- [ ] Telerivet history backfill still blocked: `TELERIVET_API_KEY` needs to be set as a project secret before `/api/public/telerivet-import` can actually pull data. This is a Lovable project environment variable, not something fixable via code.
- [ ] WhatsApp and Viber inboxes intentionally left on the shared `/inbox/$channel` layout for now — backend credentials not live yet. Revisit once WhatsApp/Viber backends are ready, applying the same table + drawer redesign as SMS/Voice.
