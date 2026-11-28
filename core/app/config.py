"""Settings come from environment variables only (in Dokploy: the Environment tab). Nothing secret in code."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"
    database_url: str = "postgresql+psycopg://rgf:rgf@localhost:5432/rgf_core"
    # Shared secret sent by the dashboard server as X-API-Key. Empty means every protected endpoint refuses.
    service_api_key: str = ""
    # One-time import of the n8n data tables only.
    n8n_base_url: str = "https://rareglobalfood.app.n8n.cloud"
    n8n_api_key: str = ""
    # n8n webhooks the backend still calls while a wave is not moved yet (statement PDFs, sending).
    n8n_webhook_base: str = "https://rareglobalfood.app.n8n.cloud/webhook"
    n8n_contact_secret: str = ""
    # THE OUTBOUND LOCK. While False nothing in this backend may send a message or place a call (SMS, Viber,
    # WhatsApp, email, voice). Every module that can reach a client must call app.outbound.ensure_allowed() first.
    # It is switched on only by an explicit decision of the owner, per environment.
    outbound_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
