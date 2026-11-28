"""Parity check: do the Python rules give the same answer as the dashboard's TypeScript loader on the same rows?

    python -m app.tools.parity --clients clients.json --ts items.json

`clients.json` is the raw n8n clients table (a JSON list of rows). `items.json` is what the dashboard loader produced
for the same rows: a list of {client_id, group, overdue, current, total, multibranch, branch_count}.
Every client is compared on its group and its amounts. Exit code 0 means identical, 1 means differences.
"""

import argparse
import json
import sys
from typing import Any

from app.domain.cycle import manila_today
from app.domain.groups import build_items, count_groups, group_of

TOLERANCE = 0.005


def compare(rows: list[dict[str, Any]], ts_items: list[dict[str, Any]], today: str) -> dict[str, Any]:
    py = {i["client_id"]: i for i in build_items(rows, today)}
    ts = {i["client_id"]: i for i in ts_items}
    mismatches: list[dict[str, Any]] = []
    for client_id in sorted(set(py) | set(ts)):
        a, b = py.get(client_id), ts.get(client_id)
        if a is None or b is None:
            mismatches.append(
                {"client_id": client_id, "problem": "only in " + ("typescript" if a is None else "python")}
            )
            continue
        diffs = {}
        if group_of(a) != b["group"]:
            diffs["group"] = [group_of(a), b["group"]]
        for key_py, key_ts in (("overdue", "overdue"), ("current", "current"), ("total", "total")):
            if abs(a[key_py] - float(b[key_ts])) > TOLERANCE:
                diffs[key_py] = [a[key_py], b[key_ts]]
        if a["branch_count"] != b["branch_count"]:
            diffs["branch_count"] = [a["branch_count"], b["branch_count"]]
        if diffs:
            mismatches.append({"client_id": client_id, "diffs": diffs})
    ts_counts = {"OVERDUE": 0, "CURRENT": 0, "OTHER": 0, "MULTIBRANCH": 0}
    for item in ts_items:
        ts_counts[item["group"]] += 1
    return {
        "as_of": today,
        "clients_python": len(py),
        "clients_typescript": len(ts),
        "counts_python": count_groups(list(py.values())),
        "counts_typescript": ts_counts,
        "mismatches": mismatches,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--clients", required=True)
    parser.add_argument("--ts", required=True)
    parser.add_argument("--today", default="")
    args = parser.parse_args(argv)
    with open(args.clients, encoding="utf-8") as fh:
        rows = json.load(fh)
    with open(args.ts, encoding="utf-8") as fh:
        ts_items = json.load(fh)
    report = compare(rows, ts_items, args.today or manila_today())
    shown = {**report, "mismatches": report["mismatches"][:20], "mismatch_count": len(report["mismatches"])}
    print(json.dumps(shown, indent=2, ensure_ascii=False))
    return 1 if report["mismatches"] else 0


if __name__ == "__main__":
    sys.exit(main())
