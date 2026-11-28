"""Foundation: audit log, per-wave switches, import runs, landed n8n rows.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# One switch for each piece that moves off n8n (see the design: waves 1 to 4). All start on the old n8n path.
SWITCHES = [
    (
        "wave1.dashboard_actions",
        "Approvals, escalations, issue history, audit, composer, contact and call commands",
    ),
    ("wave2.zoho_sync", "Zoho change feed, live invoices, nightly check"),
    ("wave2.statements", "Grouped preview, PDF confirmation, Drive copy, secure statement links"),
    ("wave3.timers", "Queue builder, retries, reports, bounce and health checks, retired features"),
    ("wave4.email", "Email: sending, Gmail replies, AI reply agent"),
    ("wave4.sms", "SMS: sending, replies, AI reply agent"),
    ("wave4.viber", "Viber: sending, replies, AI reply agent"),
    ("wave4.whatsapp", "WhatsApp: sending, replies, AI reply agent"),
    ("wave4.voice", "Voice: Grace calls, call-end and tool webhooks"),
]


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("subject_type", sa.String(40)),
        sa.Column("subject_id", sa.String(200)),
        sa.Column("detail", postgresql.JSONB(), nullable=False),
        sa.Column("request_id", sa.String(64)),
    )
    op.create_index("ix_audit_log_at", "audit_log", ["at"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])

    switches = op.create_table(
        "feature_switches",
        sa.Column("key", sa.String(80), primary_key=True),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(80), nullable=False),
    )
    op.bulk_insert(
        switches,
        [{"key": k, "mode": "n8n", "note": note, "updated_by": "migration"} for k, note in SWITCHES],
    )

    op.create_table(
        "import_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("summary", postgresql.JSONB(), nullable=False),
    )

    op.create_table(
        "n8n_rows",
        sa.Column("table_name", sa.String(60), primary_key=True),
        sa.Column("row_key", sa.String(80), primary_key=True),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("source_updated_at", sa.DateTime(timezone=True)),
        sa.Column("imported_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("n8n_rows")
    op.drop_table("import_runs")
    op.drop_table("feature_switches")
    op.drop_index("ix_audit_log_action", table_name="audit_log")
    op.drop_index("ix_audit_log_at", table_name="audit_log")
    op.drop_table("audit_log")
