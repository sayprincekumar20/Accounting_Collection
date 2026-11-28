"""Approvals: the per-company approval and the approval batches (wave 1).

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "approvals",
        sa.Column("company_key", sa.String(200), primary_key=True),
        sa.Column("client_id", sa.String(250), nullable=False),
        sa.Column("client_name", sa.String(200), nullable=False),
        sa.Column("approved", sa.Boolean(), nullable=False),
        sa.Column("approved_by", sa.String(80), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(500), nullable=False),
        sa.Column("allow_multibranch", sa.Boolean(), nullable=False),
        sa.Column("excluded_invoices", postgresql.JSONB(), nullable=False),
    )
    op.create_table(
        "approval_batches",
        sa.Column("batch_id", sa.String(160), primary_key=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_by", sa.String(80), nullable=False),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("client_count", sa.Integer(), nullable=False),
        sa.Column("balance_at_approval", sa.Numeric(14, 2), nullable=False),
        sa.Column("overdue_at_approval", sa.Numeric(14, 2), nullable=False),
        sa.Column("clients", postgresql.JSONB(), nullable=False),
        sa.Column("note", sa.String(500), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("approval_batches")
    op.drop_table("approvals")
