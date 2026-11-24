"""Document requests with secure upload links

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-24
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("account_id", sa.String(32), nullable=False),
        sa.Column("account_name", sa.String(255)),
        sa.Column("customer_number", sa.String(64)),
        sa.Column("review_id", sa.Uuid()),
        sa.Column("recipient_kind", sa.String(20), nullable=False),
        sa.Column("recipient_email", sa.String(255), nullable=False),
        sa.Column("cc", sa.String(500)),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("documents", sa.JSON(), nullable=False),
        sa.Column("uploads", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("requested_by", sa.String(255)),
        sa.Column("job_id", sa.Uuid()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_document_requests_token", "document_requests", ["token"], unique=True)
    op.create_index("ix_document_requests_account_id", "document_requests", ["account_id"])
    op.create_index("ix_document_requests_status", "document_requests", ["status"])


def downgrade() -> None:
    op.drop_table("document_requests")
