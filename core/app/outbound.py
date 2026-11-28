"""The outbound lock: nothing in this backend may send a message or place a call unless the owner has switched
OUTBOUND_ENABLED on for that environment. Every module that can reach a client calls ensure_allowed() first, so the
lock cannot be bypassed by forgetting a flag in one place. Default: locked."""

from app.config import Settings, get_settings

CHANNELS = {"sms", "viber", "whatsapp", "email", "voice"}


class OutboundDisabled(RuntimeError):
    """Raised instead of sending while the outbound lock is on."""


def ensure_allowed(channel: str, settings: Settings | None = None) -> None:
    if channel not in CHANNELS:
        raise ValueError(f"unknown channel: {channel}")
    settings = settings or get_settings()
    if not settings.outbound_enabled:
        raise OutboundDisabled(
            f"Outbound is locked: this backend may not send {channel} (OUTBOUND_ENABLED is off)"
        )
