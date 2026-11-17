# Working in this repository

One repository, two applications, deployed side by side on Dokploy (AWS Lightsail):

| Folder | What | Stack | Deployed as |
| --- | --- | --- | --- |
| `/` (src, plugins, tests) | Collections dashboard, https://accounting.rareglobalfood.com | TanStack Start + Nitro (Node 22) | Dokploy **Application**, root `Dockerfile` |
| `engine/` | Document verification engine, https://accounting.rareglobalfood.com/dv-engine | FastAPI + Celery + Postgres + Redis (Python 3.12) | Dokploy **Compose**, `engine/docker-compose.dokploy.yml` |

The dashboard's Document Verification tab (`src/routes/verification.*`, `src/routes/api/dv-reviews*`,
`src/lib/dv*.ts`) talks to the engine's review API with `DV_ENGINE_URL` + `DV_API_KEY`.

## Checks before every commit
- Dashboard: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
- Engine: `cd engine && ruff check . && python -m pytest -q`

## Rules
- Never commit secrets (`.env`, `.env.*`, keys, tokens). Settings live in Dokploy > Environment.
- Dashboard tools (ESLint, Prettier, Docker build) ignore `engine/`; the engine has its own Dockerfile.
- Zoho Deluge files in `engine/zoho/` are pasted into Zoho by hand: no comments, no apostrophes.
