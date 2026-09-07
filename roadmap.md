# Roadmap

- [x] Email tab returned to Channel Inboxes group in sidebar
- [x] Email tab restyled to match SMS inbox layout (stat cards + threads + thread panel)
- [x] Vapi AI voice call logs synced into Voice inbox (`/api/public/vapi-import` pull + `/api/public/vapi-webhook` realtime end-of-call)
- [x] Fixed wrong default `project_id` in `/api/public/telerivet-import` (was `0c188306`, should be the full `PJ0c188306515689f8`)
- [x] SMS inbox redesigned to match Voice's table + slide-in drawer pattern (was: always-visible side panel)
- [ ] Telerivet history backfill still blocked: `TELERIVET_API_KEY` needs to be set as a project secret before `/api/public/telerivet-import` can actually pull data. This is a Lovable project environment variable, not something fixable via code.
- [ ] WhatsApp and Viber inboxes intentionally left on the shared `/inbox/$channel` layout for now — backend credentials not live yet. Revisit once WhatsApp/Viber backends are ready, applying the same table + drawer redesign as SMS/Voice.
