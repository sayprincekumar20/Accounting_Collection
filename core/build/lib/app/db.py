"""Database engine and session. Created lazily so tests can point DATABASE_URL elsewhere."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True, future=True)


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with _session_factory()() as session:
        yield session


def reset_db_caches() -> None:
    """Used by tests after DATABASE_URL changes."""
    get_engine.cache_clear()
    _session_factory.cache_clear()
