"""The outbound lock: this backend cannot send a message or place a call unless the owner switches it on."""

import re
from pathlib import Path

import pytest

from app.config import Settings, get_settings
from app.outbound import CHANNELS, OutboundDisabled, ensure_allowed


def test_it_is_locked_by_default_for_every_channel():
    assert Settings().outbound_enabled is False
    for channel in CHANNELS:
        with pytest.raises(OutboundDisabled):
            ensure_allowed(channel, Settings())


def test_only_an_explicit_setting_unlocks_it_and_unknown_channels_are_refused():
    ensure_allowed("sms", Settings(outbound_enabled=True))
    with pytest.raises(ValueError):
        ensure_allowed("pigeon", Settings(outbound_enabled=True))


def test_the_test_environment_is_locked(monkeypatch):
    monkeypatch.delenv("OUTBOUND_ENABLED", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(OutboundDisabled):
            ensure_allowed("voice")
    finally:
        get_settings.cache_clear()


def test_there_is_no_sending_code_in_the_backend_yet():
    """Today no module can reach a client. When a sender is added in a later wave it must call ensure_allowed first,
    and this guard is updated on purpose in the same change."""
    app_dir = Path(__file__).resolve().parent.parent / "app"
    forbidden = re.compile(
        r"twilio|telerivet|api\.vapi\.ai|smtplib|sendgrid|gmail\.googleapis|/messages/send|calls/start", re.I
    )
    offenders = [
        p.name
        for p in app_dir.rglob("*.py")
        if p.name != "outbound.py" and forbidden.search(p.read_text(encoding="utf-8"))
    ]
    assert offenders == []
