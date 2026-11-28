# Working in this repository

One repository, two applications deployed side by side on Dokploy (AWS Lightsail), plus a third (`core/`) that is
being built and is **not deployed yet**:

| Folder | What | Stack | Deployed as |
| --- | --- | --- | --- |
| `/` (src, plugins, tests) | Collections dashboard, https://accounting.rareglobalfood.com | TanStack Start + Nitro (Node 22) | Dokploy **Application**, root `Dockerfile` |
| `engine/` | Document verification engine, https://accounting.rareglobalfood.com/dv-engine | FastAPI + Celery + Postgres + Redis (Python 3.12) | Dokploy **Compose**, `engine/docker-compose.dokploy.yml` |
| `core/` | New backend that replaces the n8n workflows wave by wave (see `core/README.md`) | FastAPI + PostgreSQL (Python 3.12) | **Not deployed.** Nothing goes live without the owner's explicit permission |

The dashboard's Document Verification tab (`src/routes/verification.*`, `src/routes/api/dv-reviews*`,
`src/lib/dv*.ts`) talks to the engine's review API with `DV_ENGINE_URL` + `DV_API_KEY`.

## Checks before every commit
- Dashboard: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
- Engine: `cd engine && ruff check . && python -m pytest -q`
- Core: `cd core && ruff check . && ruff format --check . && python -m pytest` (needs a PostgreSQL, see `core/README.md`)

## Rules
- Never commit secrets (`.env`, `.env.*`, keys, tokens). Settings live in Dokploy > Environment.
- Dashboard tools (ESLint, Prettier, Docker build) ignore `engine/` and `core/`; each has its own Dockerfile.
- Never commit customer data (exports of the n8n tables, phone numbers, emails). Parity fixtures stay outside the repository.
- Zoho Deluge files in `engine/zoho/` are pasted into Zoho by hand: no comments, no apostrophes.
