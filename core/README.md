# RGF Core

The backend that replaces the n8n workflows step by step. Design: "Replacing n8n with a FastAPI Backend, Draft
Design v2". **Nothing in this folder is deployed.** It goes live only wave by wave, each with the owner's
explicit permission, and every wave has a switch to go back to n8n.

## What exists (phase 1: foundation)

| Part | Where |
| --- | --- |
| FastAPI app, health checks (`/health/live`, `/health/ready`) | `app/main.py`, `app/api/health.py` |
| Service key (dashboard server to backend) and acting name (the name chosen at sign-in) | `app/security.py` |
| Audit log of every change (who, what, when) | `app/audit.py`, `app/api/audit.py` |
| Per-wave switches `n8n` / `shadow` / `core` (all start on `n8n`) | `app/api/switches.py` |
| PostgreSQL schema and migrations | `app/models.py`, `migrations/` |
| Read-only import of the n8n data tables into `n8n_rows` | `app/tools/import_n8n.py` |
| Business rules ported from the dashboard (same results, tested): live overdue status, invoice selection, contact checks, client groups (Overdue, Current only, Other accounts, Not contacted: 5+ branches), weekly cycle | `app/domain/` |
| Parity check against the dashboard's TypeScript loader | `app/tools/parity.py` |

Customer status (Active / Inactive in Zoho CRM) is not a group: an Inactive customer with an open balance is still
reminded.

## Run the tests

Needs a PostgreSQL. Default test database: `postgresql+psycopg://rgf:rgf@localhost:5432/rgf_core_test`
(override with `TEST_DATABASE_URL`).

```
cd core
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
ruff check . && ruff format --check .
python -m pytest
```

The tests create the schema with the real migrations (downgrade to base, then upgrade), so they also prove the
migrations work.

## Run locally

`docker compose up --build` starts PostgreSQL and the API on http://localhost:8000 (`/docs` lists the endpoints).
Protected endpoints need `X-API-Key` (dev key in `docker-compose.yml`); changes also need `X-Acting-User` (the
dashboard percent-encodes the name).

## Import the n8n tables (read-only)

```
N8N_API_KEY=... python -m app.tools.import_n8n --tables clients,approvals
```

It only sends GET requests to n8n. `GET /v1/groups/summary` then shows the group counts computed from the copy.

## Parity check with the dashboard

Export the n8n `clients` table to a JSON file outside the repository, let the dashboard's `loadApprovalItems` write
one line per client (group, overdue, current, total, branch count), then:

```
python -m app.tools.parity --clients clients.json --ts items.json
```

Exit code 0 means every client has the same group and the same amounts on both sides.
