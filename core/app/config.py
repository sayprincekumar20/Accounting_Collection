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


@lru_cache
def get_settings() -> Settings:
    return Settings()
