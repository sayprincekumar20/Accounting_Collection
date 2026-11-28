"""The weekly collection cycle runs Wednesday 00:00 to Tuesday 23:59, Manila time (UTC+8, no daylight saving)."""

from datetime import UTC, datetime, timedelta

MANILA = timedelta(hours=8)


def manila_today(now: datetime | None = None) -> str:
    """Today's date in Manila as YYYY-MM-DD."""
    now = now or datetime.now(UTC)
    return (now.astimezone(UTC) + MANILA).date().isoformat()


def cycle_start(now: datetime | None = None) -> datetime:
    """The instant (UTC) of the most recent Wednesday 00:00 in Manila."""
    now = now or datetime.now(UTC)
    manila = now.astimezone(UTC) + MANILA
    js_weekday = manila.isoweekday() % 7  # Sunday=0 ... Saturday=6, as in the dashboard code
    back = (js_weekday - 3 + 7) % 7
    midnight = datetime(manila.year, manila.month, manila.day, tzinfo=UTC) - timedelta(days=back)
    return midnight - MANILA
