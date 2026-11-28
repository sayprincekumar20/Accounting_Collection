import json

import httpx
from sqlalchemy import func, select

from app.models import ImportRun, N8nRow
from app.tools import import_n8n
from app.tools.import_n8n import fetch_all, land_rows, main


def rows_of(db, table):
    return {r.row_key: r.data for r in db.scalars(select(N8nRow).where(N8nRow.table_name == table))}


def test_landing_is_a_faithful_mirror_updates_and_removals_included(db):
    land_rows(
        db,
        "clients",
        [
            {"id": 1, "client_name": "A", "updatedAt": "2026-11-27T01:00:00.000Z"},
            {"id": 2, "client_name": "B"},
        ],
    )
    land_rows(db, "approvals", [{"id": 1, "company_key": "a"}])
    db.commit()
    assert set(rows_of(db, "clients")) == {"1", "2"}

    summary = land_rows(db, "clients", [{"id": 1, "client_name": "A renamed"}, {"id": 3, "client_name": "C"}])
    db.commit()
    assert summary == {"landed": 2, "removed": 1}
    assert rows_of(db, "clients") == {
        "1": {"id": 1, "client_name": "A renamed"},
        "3": {"id": 3, "client_name": "C"},
    }
    assert set(rows_of(db, "approvals")) == {"1"}  # other tables are untouched

    land_rows(db, "clients", [])
    db.commit()
    assert rows_of(db, "clients") == {}
    assert db.scalar(select(func.count()).select_from(N8nRow)) == 1


def test_fetch_all_follows_the_cursor_and_only_sends_get_requests():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.params.get("cursor"), request.headers["x-n8n-api-key"]))
        if request.url.params.get("cursor") is None:
            return httpx.Response(200, json={"data": [{"id": 1}, {"id": 2}], "nextCursor": "c2"})
        return httpx.Response(200, json={"data": [{"id": 3}], "nextCursor": None})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        rows = fetch_all(http, "https://n8n.example", "secret", "TABLE1")
    assert [r["id"] for r in rows] == [1, 2, 3]
    assert seen == [("GET", None, "secret"), ("GET", "c2", "secret")]


def test_fetch_all_stops_when_the_cursor_repeats():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": 1}], "nextCursor": "same"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        assert (
            len(fetch_all(http, "https://n8n.example", "k", "T")) == 2
        )  # first page, then the repeated cursor ends it


def test_run_from_a_file_records_the_import(db, tmp_path, capsys):
    path = tmp_path / "clients.json"
    path.write_text(json.dumps([{"id": 7, "client_name": "A"}]), encoding="utf-8")
    assert main(["--from-json", f"clients={path}"]) == 0
    assert json.loads(capsys.readouterr().out) == {"clients": {"landed": 1, "removed": 0}}
    run = db.scalars(select(ImportRun).order_by(ImportRun.id.desc())).first()
    assert run.status == "success" and run.summary == {"clients": {"landed": 1, "removed": 0}}


def test_unknown_table_is_refused_and_a_missing_key_fails_the_run(db, capsys):
    assert main(["--tables", "nope"]) == 2
    try:
        import_n8n.run(["clients"])
    except RuntimeError as exc:
        assert "N8N_API_KEY" in str(exc)
    else:
        raise AssertionError("expected a failure without an API key")
    run = db.scalars(select(ImportRun).order_by(ImportRun.id.desc())).first()
    assert run.status == "failed"
