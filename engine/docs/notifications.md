# Notifications: emails, Zoho Cliq channel, Google Sheets log

## Emails (company Gmail, the dashboard's mailbox)
To the person who clicked **Verify Account**, CC the **Account owner**:
| Event | Subject |
| --- | --- |
| Activated automatically | Account activated: <account> |
| Needs a review (reasons listed) | Verification in review: <account> |
| Approved by a reviewer (fields, activation) | Verification approved: <account> |
| Waiting for documents (reviewer's note) | Documents needed: <account> |
| Rejected (reason) | Verification not approved: <account> |
| Write-back failed | Verification could not be completed: <account> |

Expiry reminders (30 / 7 / 0 days, expired): to the **Account owner**, CC the person who last
verified it; by email only (`EXPIRY_CLIQ=false`; set true to also post them in Cliq).
Settings: `GMAIL_BUSINESS_EMAIL`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
(same values as the dashboard), `ZOHO_CRM_WEB_URL`, `DASHBOARD_URL` (links), `NOTIFY_EMAILS=true`.
Each email is sent once (same sent-once table as Cliq). A failed email is logged, never fatal.

## Cliq and Google Sheets

The engine announces in a Cliq channel and logs in one Google Sheet:

| Event | Cliq | Sheet tab |
| --- | --- | --- |
| Verification done (button / Run) | ✅ result, checks, missing items, automatic updates / activation | Verifications (+ Field Updates, Activations) |
| Review approved (Applied / Conflict / Failed) | 👍 who approved, fields written, activation | Field Updates (+ Activations) |
| Document expiring in 30 / 7 / 0 days or expired | ⚠️ reminder to collect the renewal | Document Expiry (Status Open) |
| Alerted document renewed | ♻️ renewed, new expiry date | Document Expiry (Status Renewed) |

Each message is sent once (table `notifications`). Reviews are checked every
REVIEW_APPLY_INTERVAL_SECONDS; the expiry check runs once a day after EXPIRY_CHECK_HOUR (Manila).
Before an expiry reminder, the engine looks at the Account's attachments: if files were added
after the last verification, it re-verifies the Account first (only new files go to the AI) and
reminds only if the document is still expiring. Reviews older than 3 days when the feature is
first switched on are recorded silently (no flood).

## Zoho Cliq
1. Channel: unique name (e.g. `accountactivation`); its API endpoint is shown in the channel's
   API parameters: `https://cliq.zoho.com/company/<id>/api/v2/channelsbyname/<name>/message`
2. Cliq > Bots & Tools > Webhook Tokens > Generate token.
3. `.env`: `CLIQ_MESSAGE_URL=<endpoint>` and `CLIQ_WEBHOOK_TOKEN=<token>`.

## Google Sheet (service account, nobody has to log in)
1. Create an empty Google Sheet in the Drive folder (e.g. "Account Activation Log"); copy its id
   from the address: `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`.
2. console.cloud.google.com > create/select a project > APIs & Services > Library > enable
   **Google Sheets API**.
3. IAM & Admin > Service Accounts > Create (name `dv-engine`, no roles needed) > open it > Keys >
   Add key > JSON: a key file downloads. Keep it private.
4. In the Sheet: Share > add the service account's email (`dv-engine@<project>.iam.gserviceaccount.com`)
   as **Editor**.
5. `.env`: `GOOGLE_SHEET_ID=<id>` and `GOOGLE_SERVICE_ACCOUNT_FILE=/run/secrets/google-sa.json`
   (on the server copy the key file there; locally any path), or paste the whole key into
   `GOOGLE_SERVICE_ACCOUNT_JSON`.
The engine creates the four tabs with header rows on first use.

## Test
`python scripts/test_notifications.py --env .env.sandbox` posts one test message and one test row.


## Expiry tracking (Nov 2026)

- **Daily (8:00 Manila):** reminders at 30, 7 and 0 days to the Account Owner (CC the last
  requester); after expiry the reminder **repeats every EXPIRED_REPEAT_DAYS (7)** until the renewed
  document is verified.
- **New files:** before any reminder the engine compares the files on the Account now
  (attachments, file fields, note files; by Zoho file id) with those the last verification read;
  new files mean a new verification instead of a reminder.
- **Weekly scan (NEW_FILE_SCAN_WEEKDAY, Monday):** accounts with a document expiring within
  NEW_FILE_SCAN_DAYS (60) or expired are checked the same way (3 Zoho calls each); only accounts
  with new files are verified again, and only new files go to the AI.
- **Renewed:** when a new verification finds a later expiry date for an alerted document, the
  Account Owner gets "<document> renewed" and the reminders for the old date stop.
- **Dashboard:** Document Verification > Document expiry (GET /v1/expiry): every document of each
  account's latest verification with valid until, days left, state, reminders sent, link to the
  review.
