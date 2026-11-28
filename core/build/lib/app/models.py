"""Phase 1 schema: foundation tables only.

The business tables (clients, invoices, approvals, conversations, sends...) are added wave by wave. Until then the
data of the n8n tables is landed as-is in `n8n_rows` (one JSON document per row), so it can be compared with n8n
before anything depends on it.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class AuditLog(Base):
    """Who did what and when: every approval, PDF confirmation, send and switch change is recorded here."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(80), index=True)
    subject_type: Mapped[str | None] = mapped_column(String(40))
    subject_id: Mapped[str | None] = mapped_column(String(200))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64))


class FeatureSwitch(Base):
    """One switch per piece being moved off n8n. mode: n8n (old path), shadow (runs, writes nothing live), core."""

    __tablename__ = "feature_switches"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    mode: Mapped[str] = mapped_column(String(10), default="n8n")
    note: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str] = mapped_column(String(80), default="system")


class ImportRun(Base):
    __tablename__ = "import_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="running")
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class N8nRow(Base):
    """A row of an n8n data table, landed unchanged (read-only copy)."""

    __tablename__ = "n8n_rows"

    table_name: Mapped[str] = mapped_column(String(60), primary_key=True)
    row_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
