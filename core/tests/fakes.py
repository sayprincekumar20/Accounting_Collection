"""In-memory stand-ins for n8n's data tables and webhooks (no network, no real data)."""

import threading


class FakeTables:
    def __init__(self, tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.calls = []
        self.fail_on = None
        self._lock = threading.Lock()

    def get_rows(self, table, column, value):
        with self._lock:
            self.calls.append(("get", table, value))
            return [dict(r) for r in self.tables.get(table, []) if str(r.get(column)) == value]

    def insert(self, table, rows):
        if self.fail_on == "insert":
            raise RuntimeError("n8n is down")
        with self._lock:
            self.calls.append(("insert", table, len(rows)))
            self.tables.setdefault(table, []).extend(dict(r) for r in rows)

    def update(self, table, column, value, data):
        if self.fail_on == "update":
            raise RuntimeError("n8n is down")
        with self._lock:
            self.calls.append(("update", table, value))
            for r in self.tables.get(table, []):
                if str(r.get(column)) == value:
                    r.update(data)


class FakeHooks:
    def __init__(self):
        self.calls = []
        self.fail = False

    def regenerate_pdfs(self, client_ids, requested_by):
        if self.fail:
            raise RuntimeError("webhook not published")
        self.calls.append((client_ids, requested_by))
        return len(client_ids)
