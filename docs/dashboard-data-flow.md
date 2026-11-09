# Accounting Collection Dashboard — Data Flow Reference

**Stack:** TanStack Start (React 19 + Nitro) · Deployed as a Cloudflare Worker (`cloudflare-module` preset, auto-deploy via Workers Builds on push to `main`)

**Two data sources feed this dashboard:**

1. **Direct API calls** — Gmail, Vapi, Telerivet, Twilio — called straight from this app's own server routes, bypassing n8n entirely, to avoid burning n8n execution quota on every dashboard refresh.
2. **n8n webhook proxies** — for data that genuinely only exists inside n8n's own Data Tables (queue state, promise/escalation history, daily run stats) and has no external source to fetch it from instead.

---

## Email tab (`src/routes/email.tsx`)

| Route                                            | Calls                                                               | Source        |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------- |
| `/api/gmail-threads-list`                        | Gmail API (`gmail.googleapis.com`) directly, metadata-only, chunked | Gmail (OAuth) |
| `/api/gmail-thread-detail?threadId=`             | Gmail API, full message bodies                                      | Gmail (OAuth) |
| `/api/gmail-attachment?messageId=&attachmentId=` | Gmail API, raw attachment bytes                                     | Gmail (OAuth) |

Thread list is filtered to only clients matched against n8n's Clients table (`/api/clients-list`), and `promise_recorded`/`notified_ar` badges are matched by exact `client_id` against `/api/promise-history` and `/api/escalations` — both still n8n-proxied.

**Credentials used:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_BUSINESS_EMAIL`

Human replies are sent by `/api/gmail-send`. The reply can include sanitized rich HTML and uploaded attachments. Attachments are stored temporarily in a private Supabase Storage bucket.

---

## Voice tab (`src/routes/voice.tsx`)

| Route                                                                             | Calls                                                                                                             | Source |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| `/api/vapi-calls-list`                                                            | Vapi API (`api.vapi.ai/call`) directly                                                                            | Vapi   |
| `/api/vapi-call-detail?callId=`                                                   | Vapi API — summary/satisfaction from `artifact.structuredOutputs[id].result`, transcript from `artifact.messages` | Vapi   |
| `/api/vapi-call-audio?callId=`                                                    | Vapi's authenticated `/call/{id}/mono-recording` endpoint, buffered fully server-side                             | Vapi   |
| `/api/call-promise-logs`, `/api/call-escalation-logs`, `/api/client-call-summary` | still n8n-proxied — voice-specific promise/escalation history                                                     | n8n    |

**Credentials used:** `VAPI_PRIVATE_KEY`, `VAPI_ASSISTANT_ID` (optional filter)

---

## SMS tab (`src/routes/sms.tsx`)

| Route                    | Calls                                                                             | Source    |
| ------------------------ | --------------------------------------------------------------------------------- | --------- |
| `/api/sms-conversations` | Telerivet API (`api.telerivet.com`) directly, both directions of the conversation | Telerivet |

`promise_recorded`/`notified_ar` matched by phone-digit identity against `/api/promise-history` and `/api/escalations`.

**Credentials used:** `TELERIVET_API_KEY`, `TELERIVET_PROJECT_ID`, `TELERIVET_SMS_PHONE_ID`

---

## WhatsApp tab (`src/routes/whatsapp.tsx`)

| Route                         | Calls                                  | Source |
| ----------------------------- | -------------------------------------- | ------ |
| `/api/whatsapp-conversations` | Twilio API (`api.twilio.com`) directly | Twilio |

Same identity-based promise/escalation matching as SMS.

**Credentials used:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`

---

## Viber tab

| Route                      | Calls                                                     | Source    |
| -------------------------- | --------------------------------------------------------- | --------- |
| `/api/viber-conversations` | Telerivet API directly, filtered to the Viber phone/route | Telerivet |

Human replies are sent through `/api/viber-send`, including temporary media URLs for attachments. The reply endpoint uses the same Telerivet project and Viber route as the Viber inbox.

## Human replies and attachments

The shared composer supports replies through Gmail, SMS, WhatsApp, and Viber. SMS remains text-only. Email, WhatsApp, and Viber can attach files from a device; Google Drive files can also be selected using Google Picker. WhatsApp is limited to one media file per message; the other supported channels permit up to 10. Files are limited to 15 MB each and 20 MB total per reply.

Uploads are stored in a private Supabase Storage bucket. The Worker uses a server-only Supabase service-role key and exposes a random, unguessable media URL only for provider download; the route checks file expiry and is the only unauthenticated application API path. Objects expire after 72 hours and a six-hour Cloudflare Cron Trigger removes expired objects. Failed delivery does not immediately delete the attachment, so the provider can fetch it asynchronously.

### Supabase Storage and Google Drive setup

The app uses **Google Drive as an optional file-selection source** and **Supabase Storage as the application's temporary storage and delivery layer**. Google Picker lets a user choose specific files; the browser requests the `drive.file` scope rather than broad access to the user's entire Drive. The selected file is downloaded or exported by the browser and uploaded to the app's private Supabase bucket before sending. Device uploads use the same path.

1. In Supabase, create a **private** Storage bucket named `reply-media`. Set its file size limit to 15 MB. Do not make the bucket public.
2. The Supabase project URL and bucket name are configured as `SUPABASE_URL` and `SUPABASE_STORAGE_BUCKET` in `wrangler.jsonc`. Set only the server-side `service_role` key as the encrypted Cloudflare Worker secret `SUPABASE_SERVICE_ROLE_KEY`. Never expose that key to browser code.
3. Keep the `0 */6 * * *` Cron Trigger in `wrangler.jsonc`; it runs the cleanup job, which deletes expired objects from Supabase.
4. In Google Cloud, enable the Google Drive API and configure the OAuth consent screen. Create a browser OAuth client ID with the dashboard's production and local development origins as authorized JavaScript origins.
5. Create an API key restricted to the Google Drive API and the dashboard's web origins. Find the numeric Google Cloud project number for the Picker App ID.
6. Add `GOOGLE_PICKER_API_KEY`, `GOOGLE_PICKER_CLIENT_ID`, and `GOOGLE_PICKER_APP_ID` to the Worker variables. The Picker requests the `drive.file` scope so access is limited to files the user selects.
7. Google Docs, Sheets, and Slides selected in Drive are exported to PDF or XLSX before upload. This does not modify the source file in Drive.

Files are limited to 15 MB each and 20 MB total per reply; WhatsApp allows one attachment per message. Supabase objects expire after 72 hours and are removed by the scheduled cleanup. Existing temporary attachments in R2 are not migrated; reattach any files in unsent drafts after deployment. Provider accounts must be configured for media sending. Twilio/WhatsApp limits and recipient session rules, as well as Telerivet route capabilities, still apply.

---

## Clients tab, Reminder Queue tab, Overview tab, Reports tab

All of these still read from **n8n webhook proxies**, because the underlying data is genuinely internal n8n state with no external source:

| Route                      | n8n Data Table it reads                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `/api/clients-list`        | Clients table — populated daily by `00C_Directory_Sheet_Data_Fetch` |
| `/api/reminder-queue-list` | Reminder Queue table                                                |
| `/api/daily-run-logs`      | Daily Run Log v2 table                                              |
| `/api/channel-counters`    | shared per-channel daily quota counters (EMAIL/SMS/VOICE)           |
| `/api/promise-history`     | promise_history table, written by `AR_Reply_Agent`                  |
| `/api/escalations`         | escalations table, written by `AR_Reply_Agent`                      |

**Env var used for all of these:** `N8N_WEBHOOK_BASE_URL`

---

## Where the underlying data actually originates (n8n side)

```
00C_Directory_Sheet_Data_Fetch (daily, 1:00 PM)
  reads: AR Overdue Google Sheet + Contacts Directory Google Sheet
  writes: Clients table, Reminder Queue table, Daily Run Log
  dispatches: Email/SMS primary send (04–07 channel workflows) + Voice (13, parallel)
       ↓
AR_Reply_Agent
  handles inbound replies across text channels
  writes: promise_history, escalations tables when it detects a promise or issue
```

The dashboard remains read-only against n8n's tables. Human replies are sent to the configured email/SMS/WhatsApp/Viber providers, and temporary reply attachments are stored in Supabase Storage as described above.
