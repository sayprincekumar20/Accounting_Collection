"""The dashboard server calls this backend with a shared key and tells it who is acting (the name chosen at sign-in).

- X-API-Key: required on every /v1 endpoint. If SERVICE_API_KEY is not configured the endpoints refuse (fail closed).
- X-Acting-User: required on every change. The name is percent-encoded by the dashboard so any characters survive.
"""

import hmac
from urllib.parse import unquote

from fastapi import Depends, Header, HTTPException

from app.config import Settings, get_settings


def require_service(
    x_api_key: str | None = Header(default=None), settings: Settings = Depends(get_settings)
) -> None:
    if not settings.service_api_key:
        raise HTTPException(status_code=503, detail="Service key is not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key.encode(), settings.service_api_key.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def acting_user(x_acting_user: str | None = Header(default=None)) -> str:
    name = unquote(x_acting_user or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(status_code=400, detail="X-Acting-User is required (1 to 80 characters)")
    return name
