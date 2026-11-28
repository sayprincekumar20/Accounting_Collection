import os
import subprocess
import sys
from pathlib import Path

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://rgf:rgf@localhost:5432/rgf_core_test")
os.environ["DATABASE_URL"] = TEST_DB
os.environ["SERVICE_API_KEY"] = "test-key"
os.environ["N8N_API_KEY"] = ""

CORE_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def migrated_db():
    """A real PostgreSQL with the migrations applied from scratch (also proves upgrade/downgrade work)."""
    from sqlalchemy import create_engine, text

    try:
        with create_engine(TEST_DB).connect() as conn:
            conn.execute(text("select 1"))
    except Exception as exc:  # no database in this environment
        pytest.skip(f"PostgreSQL not available for tests: {exc}")
    env = {**os.environ, "DATABASE_URL": TEST_DB}
    for args in (["downgrade", "base"], ["upgrade", "head"]):
        subprocess.run(
            [sys.executable, "-m", "alembic", *args], cwd=CORE_DIR, env=env, check=True, capture_output=True
        )
    return TEST_DB


@pytest.fixture()
def db(migrated_db):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from app.db import get_engine, reset_db_caches

    reset_db_caches()
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text("truncate audit_log, import_runs, n8n_rows, approvals, approval_batches restart identity")
        )
        conn.execute(text("update feature_switches set mode='n8n', updated_by='migration'"))
    with Session(engine) as session:
        yield session


@pytest.fixture()
def client(db):
    from fastapi.testclient import TestClient

    from app.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    return TestClient(create_app(), headers={"X-API-Key": "test-key"})
