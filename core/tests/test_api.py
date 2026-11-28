from app.domain.common import dumps
from app.tools.import_n8n import land_rows


def test_health(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ok", "database": "ok"}


def test_protected_endpoints_refuse_without_or_with_a_wrong_key(client):
    for headers in ({"X-API-Key": ""}, {"X-API-Key": "wrong"}):
        r = client.get("/v1/switches", headers=headers)
        assert r.status_code == 401


def test_protected_endpoints_refuse_when_no_key_is_configured(db, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import create_app

    monkeypatch.setenv("SERVICE_API_KEY", "")
    get_settings.cache_clear()
    try:
        r = TestClient(create_app()).get("/v1/switches", headers={"X-API-Key": "anything"})
        assert r.status_code == 503
    finally:
        monkeypatch.setenv("SERVICE_API_KEY", "test-key")
        get_settings.cache_clear()


def test_switches_start_on_n8n_and_a_change_is_audited_with_the_acting_name(client):
    items = client.get("/v1/switches").json()["items"]
    assert len(items) == 9 and {i["mode"] for i in items} == {"n8n"}
    assert "wave4.voice" in {i["key"] for i in items}

    r = client.put("/v1/switches/wave3.timers", json={"mode": "shadow", "note": "start the shadow week"},
                   headers={"X-Acting-User": "Mar%C3%ADa%20Santos"})  # fmt: skip
    assert r.status_code == 200 and r.json()["mode"] == "shadow" and r.json()["updated_by"] == "María Santos"

    log = client.get("/v1/audit", params={"action": "switch.changed"}).json()["items"]
    assert log[0]["actor"] == "María Santos" and log[0]["subject_id"] == "wave3.timers"
    assert log[0]["detail"] == {"from": "n8n", "to": "shadow"}


def test_a_change_needs_the_acting_name_a_valid_mode_and_a_known_switch(client):
    assert client.put("/v1/switches/wave3.timers", json={"mode": "core"}).status_code == 400
    assert (
        client.put(
            "/v1/switches/wave3.timers", json={"mode": "bogus"}, headers={"X-Acting-User": "A"}
        ).status_code
        == 422
    )
    assert (
        client.put("/v1/switches/nope", json={"mode": "core"}, headers={"X-Acting-User": "A"}).status_code
        == 404
    )
    assert client.get("/v1/audit").json()["items"] == []  # nothing changed, nothing audited


def _client_row(i, name, *, overdue=0.0, current=0.0, **extra):
    return {"id": i, "client_id": f"{name}___x", "client_name": name, "parent_name": extra.pop("parent_name", ""), "status": "ACTIVE",
            "collection_amount": overdue + current, "overdue_total": overdue, "current_total": current,
            "branch_customer_ids": str(i), "sales_team": True, **extra}  # fmt: skip


def test_groups_summary_counts_the_landed_clients(client, db):
    rows = [
        _client_row(1, "A", overdue=10),
        _client_row(2, "B", overdue=10),
        _client_row(3, "C", current=5),
        _client_row(4, "D", overdue=5, sales_team=False),
        _client_row(5, "RETIRED", overdue=5, status="INACTIVE"),
        *[
            _client_row(10 + i, f"HQ{i}", overdue=1, parent_name="BIG", branch_customer_ids=f"x{i}")
            for i in range(5)
        ],
    ]
    land_rows(db, "clients", rows)
    db.commit()
    body = client.get("/v1/groups/summary").json()
    assert body["clients_landed"] == 10
    assert body["counts"] == {"overdue": 2, "current_only": 1, "other_accounts": 1, "multibranch_5plus": 5}
    assert body["last_import_at"] is not None
    assert dumps(body["counts"])  # serialisable
