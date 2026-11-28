import json

import httpx
import pytest

from app.n8n_mirror import HttpN8nHooks, HttpN8nTables


def tables_with(handler):
    return HttpN8nTables("https://n8n.example/", "key", httpx.Client(transport=httpx.MockTransport(handler)))


def test_reading_filters_by_column_and_uses_the_n8n_key():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url.copy_with(query=None))
        seen["filter"] = json.loads(request.url.params["filter"])
        seen["key"] = request.headers["x-n8n-api-key"]
        return httpx.Response(200, json={"data": [{"id": 1}], "nextCursor": None})

    assert tables_with(handler).get_rows("clients", "client_id", "A___x") == [{"id": 1}]
    assert (
        seen["url"] == "https://n8n.example/api/v1/data-tables/rJpqXxmxhqJnlLrJ/rows" and seen["key"] == "key"
    )
    assert seen["filter"] == {
        "type": "and",
        "filters": [{"columnName": "client_id", "condition": "eq", "value": "A___x"}],
    }


def test_insert_and_update_use_the_shapes_the_dashboard_already_uses():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={})

    t = tables_with(handler)
    t.insert("approvals", [{"company_key": "a"}])
    t.update("clients", "client_id", "A___x", {"collection_amount": 5})
    assert calls[0] == (
        "POST",
        "/api/v1/data-tables/3IvKKI4AwrBlDeOo/rows",
        {"data": [{"company_key": "a"}], "returnType": "count"},
    )
    method, path, payload = calls[1]
    assert (method, path) == ("PATCH", "/api/v1/data-tables/rJpqXxmxhqJnlLrJ/rows/update")
    assert payload["data"] == {"collection_amount": 5} and payload["filter"]["filters"][0]["value"] == "A___x"


def test_update_falls_back_to_the_older_address_and_errors_are_raised():
    paths = []

    def handler(request):
        paths.append(request.url.path)
        return httpx.Response(404 if request.url.path.endswith("/update") else 200, json={})

    tables_with(handler).update("clients", "client_id", "A", {"x": 1})
    assert paths == [
        "/api/v1/data-tables/rJpqXxmxhqJnlLrJ/rows/update",
        "/api/v1/data-tables/rJpqXxmxhqJnlLrJ/rows",
    ]
    with pytest.raises(httpx.HTTPStatusError):
        tables_with(lambda r: httpx.Response(500, json={})).insert("approvals", [{"a": 1}])


def test_a_missing_n8n_key_is_refused_early():
    with pytest.raises(RuntimeError, match="N8N_API_KEY"):
        HttpN8nTables("https://n8n.example", "")


def test_the_pdf_hook_sends_one_request_for_the_whole_batch_with_the_key():
    seen = []

    def handler(request):
        seen.append((request.url.path, request.headers["x-cliq-secret"], json.loads(request.content)))
        return httpx.Response(200, json={"ok": True, "queued": 2})

    hooks = HttpN8nHooks(
        "https://n8n.example/webhook", "secret", httpx.Client(transport=httpx.MockTransport(handler))
    )
    assert hooks.regenerate_pdfs(["A", "B"], "Ana") == 2
    assert seen == [
        ("/webhook/batch-regenerate-pdf", "secret", {"client_ids": ["A", "B"], "requested_by": "Ana"})
    ]
    assert hooks.regenerate_pdfs([], "Ana") == 0 and len(seen) == 1
    with pytest.raises(RuntimeError, match="N8N_CONTACT_SECRET"):
        HttpN8nHooks("https://n8n.example/webhook", "").regenerate_pdfs(["A"], "Ana")
