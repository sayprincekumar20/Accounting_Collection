# Deploying the engine on Dokploy (next to the dashboard)

Result: `https://accounting.rareglobalfood.com/dv-engine` is the engine (Zoho Verify Account button),
`https://accounting.rareglobalfood.com/verification` is the dashboard tab that reviews its results.

## 1. Create the service
Dokploy > the dashboard's project > **Create Service > Compose**
| Setting | Value |
| --- | --- |
| Name | `dv-engine` |
| Source | GitHub, `sayprincekumar20/Accounting_Collection`, branch `main` |
| Compose Type | Docker Compose |
| Compose Path | `./engine/docker-compose.dokploy.yml` |

## 2. Environment (Dokploy > dv-engine > Environment)
Required:
```
POSTGRES_PASSWORD=<long random text>
APP_ENV=prod
API_KEY=<engine API key - the same value goes to the Zoho Connection dv_engine and to the dashboard's DV_API_KEY>
ZOHO_ACCOUNTS_URL=https://accounts.zoho.com
ZOHO_API_DOMAIN=https://www.zohoapis.com            (sandbox: https://sandbox.zohoapis.com)
ZOHO_API_VERSION=v8
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...                              (scripts/zoho_auth.py exchange-code)
EXTRACTION_PROVIDER=openai
EXTRACTION_MODEL=gpt-6.1-sol
OPENAI_API_KEY=...
ENGINE_REVIEWS=true
CREATE_REVIEW_RECORDS=false
AUTO_APPLY_MODE=shadow
KEEP_DOCUMENT_FILES=false
```
Emails (to the person who clicked Verify Account, CC the Account owner; expiry reminders to the owner):
```
GMAIL_BUSINESS_EMAIL=<same as the dashboard>
GMAIL_CLIENT_ID=<same as the dashboard>
GMAIL_CLIENT_SECRET=<same as the dashboard>
GMAIL_REFRESH_TOKEN=<same as the dashboard; needs the gmail.send scope>
ZOHO_CRM_WEB_URL=https://crm.zoho.com/crm/org824163551
DASHBOARD_URL=https://accounting.rareglobalfood.com
```
Optional: `DV_PUBLIC_HOST` (default `accounting.rareglobalfood.com`), Cliq / Google Sheets
(`CLIQ_MESSAGE_URL`, `CLIQ_WEBHOOK_TOKEN`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` = the whole
key file on one line), `EXPIRY_CHECK_HOUR`, `REVIEW_IMAGE_DAYS`. `DATABASE_URL`, `REDIS_URL` and storage
are set by the compose file.

## 3. Deploy
Press **Deploy**. The first build takes 10-15 minutes (Tesseract, LibreOffice). Then:
```
curl https://accounting.rareglobalfood.com/dv-engine/health/live        -> {"status":"ok"}
curl -H "X-API-Key: <API_KEY>" https://accounting.rareglobalfood.com/dv-engine/health/zoho
```
The public route comes from the Traefik labels in the compose file (Host + PathPrefix `/dv-engine`,
prefix stripped, Let's Encrypt). Do **not** also add a Domain for this service in the Dokploy UI.

## 4. Connect the dashboard (Dokploy > dashboard app > Environment)
```
DV_ENGINE_URL=http://dv-engine-api:8000      (internal: both services are on dokploy-network)
DV_API_KEY=<the engine's API_KEY>
```
Redeploy the dashboard. If the internal name does not resolve, use the public address
`https://accounting.rareglobalfood.com/dv-engine` instead.

## 5. Connect Zoho CRM
- Variable `dv_engine_url` = `https://accounting.rareglobalfood.com/dv-engine`
- Connection `dv_engine` (API key header `X-API-Key`) = the engine's `API_KEY`
- Trusted Domain: `https://accounting.rareglobalfood.com`
Then click **Verify Account** on an Account (Payment Terms = Cash On Delivery, documents attached):
the review appears in the dashboard's Document Verification tab within 1-3 minutes.

## Operations
- Logs: Dokploy > dv-engine > Logs (api / worker / scheduler)
- Database backup: Dokploy > dv-engine > Backups, or `docker exec <postgres container> pg_dump -U dv dv`
- Memory: the engine needs about 2-3 GB; the dashboard build about 2 GB (add swap on small instances)
