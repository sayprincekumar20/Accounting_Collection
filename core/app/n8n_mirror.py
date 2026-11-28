"""Keeping n8n's data tables up to date while n8n still sends the messages.

Until a wave is moved, n8n's senders read their data from n8n's own tables. So every change the backend makes is also
written there, through n8n's data API (a plain REST call: it does not start a workflow execution and does not count
against the monthly limit). The only thing that still goes through an n8n webhook is making the statement PDF again.
"""

import json
from typing import Any, Protocol

import httpx

from app.config import Settings
from app.n8n_ids import TABLES


class N8nTables(Protocol):
    def get_rows(self, table: str, column: str, value: str) -> list[dict[str, Any]]: ...
    def insert(self, table: str, rows: list[dict[str, Any]]) -> None: ...
    def update(self, table: str, column: str, value: str, data: dict[str, Any]) -> None: ...


class N8nHooks(Protocol):
    def regenerate_pdfs(self, client_ids: list[str], requested_by: str) -> int: ...


class HttpN8nTables:
    def __init__(self, base_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        if not api_key:
            raise RuntimeError("N8N_API_KEY is not configured")
        self._base = base_url.rstrip("/")
        self._headers = {"X-N8N-API-KEY": api_key, "Content-Type": "application/json"}
        self._http = client or httpx.Client(timeout=30)

    def _url(self, table: str, suffix: str = "") -> str:
        return f"{self._base}/api/v1/data-tables/{TABLES[table]}/rows{suffix}"

    @staticmethod
    def _filter(column: str, value: str) -> dict[str, Any]:
        return {"type": "and", "filters": [{"columnName": column, "condition": "eq", "value": value}]}

    def get_rows(self, table: str, column: str, value: str) -> list[dict[str, Any]]:
        resp = self._http.get(
            self._url(table),
            params={"limit": "250", "filter": json.dumps(self._filter(column, value))},
            headers=self._headers,
        )
        resp.raise_for_status()
        return list(resp.json().get("data") or [])

    def insert(self, table: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        resp = self._http.post(
            self._url(table), json={"data": rows, "returnType": "count"}, headers=self._headers
        )
        resp.raise_for_status()

    def update(self, table: str, column: str, value: str, data: dict[str, Any]) -> None:
        body = {"filter": self._filter(column, value), "data": data}
        resp = self._http.patch(self._url(table, "/update"), json=body, headers=self._headers)
        if resp.status_code in (404, 405):  # n8n has used both PATCH /rows/update and PATCH /rows
            resp = self._http.patch(self._url(table), json=body, headers=self._headers)
        resp.raise_for_status()


class HttpN8nHooks:
    """Webhooks of the n8n workflows that are not replaced yet."""

    def __init__(self, webhook_base: str, contact_secret: str, client: httpx.Client | None = None) -> None:
        self._base = webhook_base.rstrip("/")
        self._secret = contact_secret
        self._http = client or httpx.Client(timeout=30)

    def regenerate_pdfs(self, client_ids: list[str], requested_by: str) -> int:
        """Ask n8n to make the statement PDFs again (one request for the whole batch). Returns how many were queued."""
        if not client_ids:
            return 0
        if not self._secret:
            raise RuntimeError("N8N_CONTACT_SECRET is not configured")
        resp = self._http.post(
            f"{self._base}/batch-regenerate-pdf",
            json={"client_ids": client_ids, "requested_by": requested_by},
            headers={"x-cliq-secret": self._secret},
        )
        resp.raise_for_status()
        return int(resp.json().get("queued", len(client_ids)))


def tables_from_settings(settings: Settings) -> N8nTables:
    return HttpN8nTables(settings.n8n_base_url, settings.n8n_api_key)


def hooks_from_settings(settings: Settings) -> N8nHooks:
    return HttpN8nHooks(settings.n8n_webhook_base, settings.n8n_contact_secret)
