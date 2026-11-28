"""One-time (and repeatable) READ-ONLY import of the n8n data tables into `n8n_rows`.

It only sends GET requests to n8n. Landing is a faithful mirror: rows are inserted or updated by id, and rows that
no longer exist in n8n are removed from the copy. Run:

    python -m app.tools.import_n8n                       # every known table
    python -m app.tools.import_n8n --tables clients,approvals
    python -m app.tools.import_n8n --from-json clients=./clients.json   # land a file (offline / tests)
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import delete, true
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_engine
from app.models import ImportRun, N8nRow
from app.n8n_ids import TABLES

PAGE_LIMIT = 250
MAX_PAGES = 400  # 100,000 rows: a safety stop, never silently truncating (it raises)
BATCH = 500


def fetch_all(client: httpx.Client, base_url: str, api_key: str, table_id: str) -> list[dict[str, Any]]:
    """GET every row of a data table, following the cursor."""
    rows: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(MAX_PAGES):
        params: dict[str, str] = {"limit": str(PAGE_LIMIT)}
        if cursor:
            params["cursor"] = cursor
        resp = client.get(
            f"{base_url}/api/v1/data-tables/{table_id}/rows",
            params=params,
            headers={"X-N8N-API-KEY": api_key},
            timeout=60,
        )
        resp.raise_for_status()
        body = resp.json()
        page = body.get("data") or []
        rows.extend(page)
        next_cursor = body.get("nextCursor")
        if not next_cursor or next_cursor == cursor or not page:
            return rows
        cursor = next_cursor
    raise RuntimeError(
        f"table {table_id} has more than {MAX_PAGES * PAGE_LIMIT} rows: stopped, nothing was landed"
    )


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def land_rows(session: Session, table_name: str, rows: list[dict[str, Any]]) -> dict[str, int]:
    """Mirror `rows` into n8n_rows for one table: upsert by id, remove rows that are gone. Caller commits."""
    keys = []
    for start in range(0, len(rows), BATCH):
        values = []
        for row in rows[start : start + BATCH]:
            key = str(row["id"])
            keys.append(key)
            values.append(
                {
                    "table_name": table_name,
                    "row_key": key,
                    "data": row,
                    "source_updated_at": _parse_ts(row.get("updatedAt")),
                }
            )
        stmt = insert(N8nRow).values(values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["table_name", "row_key"],
            set_={
                "data": stmt.excluded.data,
                "source_updated_at": stmt.excluded.source_updated_at,
                "imported_at": datetime.now(UTC),
            },
        )
        session.execute(stmt)
    removed = session.execute(
        delete(N8nRow).where(N8nRow.table_name == table_name, N8nRow.row_key.not_in(keys) if keys else true())
    ).rowcount
    return {"landed": len(rows), "removed": removed or 0}


def run(tables: list[str], from_json: dict[str, str] | None = None) -> dict[str, Any]:
    settings = get_settings()
    summary: dict[str, Any] = {}
    with Session(get_engine()) as session:
        record = ImportRun(source="n8n" if not from_json else "file", status="running", summary={})
        session.add(record)
        session.commit()
        try:
            with httpx.Client() as http:
                for name in tables:
                    if from_json and name in from_json:
                        with open(from_json[name], encoding="utf-8") as fh:
                            rows = json.load(fh)
                    else:
                        if not settings.n8n_api_key:
                            raise RuntimeError("N8N_API_KEY is not set")
                        rows = fetch_all(http, settings.n8n_base_url, settings.n8n_api_key, TABLES[name])
                    summary[name] = land_rows(session, name, rows)
                    session.commit()
            record.status = "success"
        except Exception as exc:
            session.rollback()
            record.status = "failed"
            summary["error"] = str(exc)[:300]
            raise
        finally:
            record.summary = summary
            record.finished_at = datetime.now(UTC)
            session.add(record)
            session.commit()
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--tables", default="", help="comma separated table names (default: all)")
    parser.add_argument("--from-json", action="append", default=[], metavar="NAME=FILE")
    args = parser.parse_args(argv)
    from_json = dict(item.split("=", 1) for item in args.from_json)
    names = [t for t in args.tables.split(",") if t] or list(from_json) or list(TABLES)
    unknown = [t for t in names if t not in TABLES]
    if unknown:
        print(f"unknown table(s): {', '.join(unknown)}", file=sys.stderr)
        return 2
    print(json.dumps(run(names, from_json), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
