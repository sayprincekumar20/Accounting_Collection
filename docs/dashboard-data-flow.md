# Accounting Collection Dashboard — Data Flow Reference

**Stack:** TanStack Start (React 19 + Nitro) · Deployed as a Cloudflare Worker (`cloudflare-module` preset, auto-deploy via Workers Builds on push to `main`)

**Two data sources feed this dashboard:**
1. **Direct API calls** — Gmail, Vapi, Telerivet, Twilio — called straight from this app's own server routes, bypassing n8n entirely, to avoid burning n8n execution quota on every dashboard refresh.
2. **n8n webhook proxies** — for data that genuinely only exists inside n8n's own Data Tables (queue state, promise/escalation history, daily run stats) and has no external source to fetch it from instead.

---

## Email tab (`src/routes/email.tsx`)

| Route | Calls | Source |
|---|---|---|
| `/api/gmail-threads-list` | Gmail API (`gmail.googleapis.com`) directly, metadata-only, chunked | Gmail (OAuth) |
| `/api/gmail-thread-detail?threadId=` | Gmail API, full message bodies | Gmail (OAuth) |
| `/api/gmail-attachment?messageId=&attachmentId=` | Gmail API, raw attachment bytes | Gmail (OAuth) |

Thread list is filtered to only clients matched against n8n's Clients table (`/api/clients-list`), and `promise_recorded`/`notified_ar` badges are matched by exact `client_id` against `/api/promise-history` and `/api/escalations` — both still n8n-proxied.

**Credentials used:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_BUSINESS_EMAIL`

---

## Voice tab (`src/routes/voice.tsx`)

| Route | Calls | Source |
|---|---|---|
| `/api/vapi-calls-list` | Vapi API (`api.vapi.ai/call`) directly | Vapi |
| `/api/vapi-call-detail?callId=` | Vapi API — summary/satisfaction from `artifact.structuredOutputs[id].result`, transcript from `artifact.messages` | Vapi |
| `/api/vapi-call-audio?callId=` | Vapi's authenticated `/call/{id}/mono-recording` endpoint, buffered fully server-side | Vapi |
| `/api/call-promise-logs`, `/api/call-escalation-logs`, `/api/client-call-summary` | still n8n-proxied — voice-specific promise/escalation history | n8n |

**Credentials used:** `VAPI_PRIVATE_KEY`, `VAPI_ASSISTANT_ID` (optional filter)

---

## SMS tab (`src/routes/sms.tsx`)

| Route | Calls | Source |
|---|---|---|
| `/api/sms-conversations` | Telerivet API (`api.telerivet.com`) directly, both directions of the conversation | Telerivet |

`promise_recorded`/`notified_ar` matched by phone-digit identity against `/api/promise-history` and `/api/escalations`.

**Credentials used:** `TELERIVET_API_KEY`, `TELERIVET_PROJECT_ID`, `TELERIVET_SMS_PHONE_ID`

---

## WhatsApp tab (`src/routes/whatsapp.tsx`)

| Route | Calls | Source |
|---|---|---|
| `/api/whatsapp-conversations` | Twilio API (`api.twilio.com`) directly | Twilio |

Same identity-based promise/escalation matching as SMS.

**Credentials used:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`

---

## Viber tab

Not live — placeholder page only, "coming soon, pending live backend credentials." No API wired.

---

## Clients tab, Reminder Queue tab, Overview tab, Reports tab

All of these still read from **n8n webhook proxies**, because the underlying data is genuinely internal n8n state with no external source:

| Route | n8n Data Table it reads |
|---|---|
| `/api/clients-list` | Clients table — populated daily by `00C_Directory_Sheet_Data_Fetch` |
| `/api/reminder-queue-list` | Reminder Queue table |
| `/api/daily-run-logs` | Daily Run Log v2 table |
| `/api/channel-counters` | shared per-channel daily quota counters (EMAIL/SMS/VOICE) |
| `/api/promise-history` | promise_history table, written by `AR_Reply_Agent` |
| `/api/escalations` | escalations table, written by `AR_Reply_Agent` |

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

The dashboard never writes back into these — it's read-only against everything, whether the source is a direct API or an n8n table.
