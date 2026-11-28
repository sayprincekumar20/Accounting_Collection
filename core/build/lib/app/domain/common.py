"""Small helpers shared by the domain rules. They reproduce the JavaScript behaviour the dashboard and the n8n
workflows rely on (JSON.stringify without spaces, Math.round half-up, Number(x || 0)), so results are identical."""

import json
import math
from typing import Any


def dumps(value: Any) -> str:
    """JSON.stringify: compact, non-ASCII kept as is."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def parse_json(value: Any, default: Any) -> Any:
    """JSON.parse(String(value ?? "")) that falls back to `default` when empty, null or invalid."""
    try:
        parsed = json.loads("" if value is None else str(value))
    except (TypeError, ValueError):
        return default
    return default if parsed is None else parsed


def num(value: Any) -> float:
    """Number(value || 0)."""
    if value is None or value == "" or value is False:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def r2(n: float) -> float:
    """Math.round(n * 100) / 100 (rounds halves up, like JavaScript)."""
    return math.floor(n * 100 + 0.5) / 100


def s(value: Any) -> str:
    """String(value ?? "")."""
    return "" if value is None else str(value)
