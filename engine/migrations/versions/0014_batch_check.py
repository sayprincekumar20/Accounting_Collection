"""Batch check: batches of Active accounts per channel, verified quietly

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "batch_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("number", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("channel", sa.String(120), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_by", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_batch_runs_channel", "batch_runs", ["channel"])
    op.create_index("ix_batch_runs_status", "batch_runs", ["status"])
    op.create_table(
        "batch_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("batch_runs.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.String(32), nullable=False),
        sa.Column("account_name", sa.String(255)),
        sa.Column("customer_number", sa.String(64)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("job_id", sa.Uuid()),
        sa.Column("review_id", sa.Uuid()),
        sa.Column("result", sa.JSON()),
        sa.Column("spot_check", sa.String(20)),
        sa.Column("spot_note", sa.Text()),
        sa.Column("spot_by", sa.String(255)),
        sa.Column("spot_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_batch_items_batch_id", "batch_items", ["batch_id"])
    op.create_index("ix_batch_items_account_id", "batch_items", ["account_id"])
    op.add_column("reviews", sa.Column("batch_id", sa.Uuid()))
    op.create_index("ix_reviews_batch_id", "reviews", ["batch_id"])


def downgrade() -> None:
    op.drop_index("ix_reviews_batch_id", "reviews")
    op.drop_column("reviews", "batch_id")
    op.drop_table("batch_items")
    op.drop_table("batch_runs")
