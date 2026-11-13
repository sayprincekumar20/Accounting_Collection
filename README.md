# RGF Collections Dashboard

Accounts-receivable (AR) collections dashboard for **Rare Global Food Trading Corp.** It shows everything the collections automation does: which clients are overdue, who was contacted on which channel, what clients replied, payment promises, escalations to the AR team, and reports per approval batch.

All sending, calling and AI replies run in **n8n** (workflows `00` to `32` in the project _Prince_OverdueRemiander_Message_). This dashboard reads n8n's data tables, shows the conversations from each channel provider, and lets the AR team act: approve clients, contact or call them, handle escalations, and ask the AI assistant.

## What is in the dashboard

| Page                                    | What it does                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**                            | Total outstanding (and the overdue part), what is in the queue, conversations, replies, promises                                      |
| **Clients**                             | Every client with balances and invoices, last contact, **Contact** button (Viber, SMS, WhatsApp, Email or a call)                     |
| **Reminder Queue**                      | This cycle's queue: waiting, sent, skipped by a rule                                                                                  |
| **Contact Approvals**                   | The AR team approves which clients are contacted this cycle                                                                           |
| **Escalations**                         | Cases a client raised that the agents could not handle (worklist with status), and system notifications                               |
| **Promises**                            | Payment promises and their dates                                                                                                      |
| **Contacts to Fix**                     | Missing or wrong contact details, bounced emails, invalid phone numbers                                                               |
| **Reports**                             | **Approval batch reports** (one report per AR approval, with an Excel download), daily run log, AR reports                            |
| **Document Verification**               | Checks of documents sent by clients                                                                                                   |
| **WhatsApp, Viber, SMS, Email, Voice**  | Conversations per channel; Voice shows Grace's calls, results, next attempt and **Call again**                                        |
| **AI assistant** (button, bottom right) | Answers questions about the data, reads uploaded customer lists (Excel or CSV) and can approve and contact clients after confirmation |

The whole dashboard is behind one shared login (`DASHBOARD_USER` / `DASHBOARD_PASSWORD`).

## How it fits together

```
 Zoho Books ──► n8n (Cloud) ──► Email (Gmail) · SMS + Viber (Telerivet) · WhatsApp (Twilio) · Voice (Vapi, "Grace")
                  │  data tables: clients, queue, logs, conversations, promises, escalations, approval batches…
                  ▼
        RGF Collections Dashboard (this repo, Node.js server)
                  │  reads n8n data tables and channel APIs; actions go to n8n webhooks
                  ▼
              AR team (browser)
```

## Tech stack

- **TanStack Start** (React 19, TanStack Router and Query) with **Nitro 3**, built by **Vite 8**
- **Tailwind CSS 4** and shadcn/ui components
- Server routes in `src/routes/api/*` (they hold the secrets; the browser never sees them)
- Node.js **22.12 or newer**
- Tests with **Vitest** (unit tests and simulated-browser tests)

## Run it locally

```sh
git clone https://github.com/sayprincekumar20/Accounting_Collection.git
cd Accounting_Collection
npm ci
cp .env.example .env      # then fill in the values you need (never commit .env)
npm run dev               # http://localhost:5173 (development server)
```

Without the `DASHBOARD_*` variables every page is blocked (the login fails closed). Without the n8n key the pages open but show no data.

| Command             | What it does                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`       | Development server with hot reload                                                             |
| `npm run build`     | Production build into `.output/` (Node server + static files)                                  |
| `npm start`         | Runs the production build: `node .output/server/index.mjs` (`HOST`, `PORT`, default port 3000) |
| `npm test`          | All tests                                                                                      |
| `npm run typecheck` | TypeScript check                                                                               |
| `npm run lint`      | ESLint                                                                                         |

## Configuration

Every secret and setting is read from the environment (`process.env`). The full list, with a one-line explanation each, is in **[`.env.example`](.env.example)**:

| Area                         | Variables                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Login                        | `DASHBOARD_USER`, `DASHBOARD_PASSWORD`, `DASHBOARD_SESSION_SECRET`                                       |
| n8n                          | `N8N_API_KEY`, `N8N_APPROVAL_SECRET`, `N8N_CONTACT_SECRET`, `N8N_WA_REMINDER_KEY`, `N8N_WORKLIST_SECRET` |
| AI assistant                 | `OPENAI_API_KEY`, `OPENAI_MODEL` (optional, default `gpt-4.1`)                                           |
| Gmail                        | `GMAIL_BUSINESS_EMAIL`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`                  |
| Google Picker                | `GOOGLE_PICKER_API_KEY`, `GOOGLE_PICKER_CLIENT_ID`, `GOOGLE_PICKER_APP_ID`                               |
| Telerivet (SMS, Viber)       | `TELERIVET_API_KEY`, `TELERIVET_PROJECT_ID`, `TELERIVET_SMS_PHONE_ID`                                    |
| Twilio (WhatsApp)            | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`                                      |
| Vapi (Voice)                 | `VAPI_PRIVATE_KEY`, `VAPI_ASSISTANT_ID` (optional)                                                       |
| Document Verification        | `DV_ENGINE_URL`, `DV_API_KEY`                                                                            |
| Reply attachments (Supabase) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`                                   |

Never put real values in the code, in `.env.example` or in a commit.

## Deployment (Dokploy on AWS Lightsail)

Production runs as a Docker container on a self-hosted **Dokploy** server (AWS Lightsail, Ubuntu). Traefik, managed by Dokploy, provides HTTPS. The repository's **[`Dockerfile`](Dockerfile)** builds the image:

1. **Build stage** (`node:22-alpine`): `npm ci` then `npm run build`
2. **Run stage** (`node:22-alpine`): only `.output/` is copied; runs as the non-root `node` user on `0.0.0.0:3000` with a built-in health check

**Dokploy settings**

| Setting         | Value                                                           |
| --------------- | --------------------------------------------------------------- |
| Service type    | Application                                                     |
| App name        | `rgf-collections-dashboard`                                     |
| Source          | GitHub, `sayprincekumar20/Accounting_Collection`, branch `main` |
| Build Type      | Dockerfile                                                      |
| Dockerfile Path | `Dockerfile`                                                    |
| Build Path      | `/`                                                             |
| Environment     | every variable from `.env.example`, with real values            |
| Domain          | container port `3000`, HTTPS on (Let's Encrypt)                 |
| Health check    | `GET /api/health` returns `{"status":"ok"}` (no login needed)   |

**Deploying a change:** push to `main`, then press **Deploy** in Dokploy (or turn on automatic deploys for the branch). Check the result with `https://<domain>/api/health`, then sign in.

**Notes**

- The build needs about 2 GB of memory. On a small Lightsail instance add swap if the build stops with "Killed" or "out of memory".
- The login cookie is `Secure`, so sign-in only works over HTTPS (the Dokploy domain).
- Data is cached in the server's memory for about 2 minutes, so a change made in n8n can take up to 2 minutes to show.
- Expired reply attachments (Supabase storage) are cleaned up by the server itself: 1 minute after start, then every 6 hours.

## History

The dashboard was first built with [Lovable](https://lovable.dev) and was hosted on Cloudflare Workers until November 2026. `wrangler.jsonc` is kept for reference only and is no longer used.

The repository is still connected to Lovable: changes made in the [Lovable editor](https://lovable.dev/projects/87e31d93-4fa3-41e6-9c48-dafabd0ec72c) are committed to this repository, and pushes to `main` sync back into Lovable.

## Project structure

```
src/
  routes/            pages (one file per page) and api/* server routes
  components/        UI: assistant/, collections/, reports/, ui/ (shadcn)
  lib/               shared logic: n8n data tables, channel clients, assistant, batch reports, Excel writer
  server.ts          server entry: health check, login gate, error page
plugins/             Nitro plugins (reply attachment cleanup timer)
tests/               Vitest tests
Dockerfile           production image (Dokploy)
.env.example         every environment variable, without values
```
