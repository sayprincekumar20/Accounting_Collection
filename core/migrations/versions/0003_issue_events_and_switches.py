"""Issue history (escalations, wave 1) and finer switches for the dashboard actions.

The switch wave1.dashboard_actions is renamed wave1.approvals and split into one switch per kind of action, so each can move on its own.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

NEW_SWITCHES = [
    (
        "wave1.escalations",
        "Escalation and system-notification status, issue history (data only, nothing is sent)",
    ),
    (
        "wave1.reminders",
        "Reminder composer: sends one reminder (stays locked until the owner allows outbound)",
    ),
    ("wave1.contact_commands", "Contact now and call again (stays locked until the owner allows outbound)"),
]


def upgrade() -> None:
    op.create_table(
        "issue_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("issue_id", sa.String(200), nullable=False),
        sa.Column("issue_kind", sa.String(12), nullable=False),
        sa.Column("ref", sa.String(80), nullable=False),
        sa.Column("event", sa.String(12), nullable=False),
        sa.Column("summary", sa.String(1000), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_issue_events_issue_id", "issue_events", ["issue_id"])
    op.execute("update feature_switches set key = 'wave1.approvals' where key = 'wave1.dashboard_actions'")
    op.execute(
        "update feature_switches set note = 'Contact Approvals: approvals, invoice ticks, batches' where key = 'wave1.approvals'"
    )
    switches = sa.table(
        "feature_switches",
        sa.column("key", sa.String),
        sa.column("mode", sa.String),
        sa.column("note", sa.Text),
        sa.column("updated_by", sa.String),
    )
    op.bulk_insert(
        switches, [{"key": k, "mode": "n8n", "note": n, "updated_by": "migration"} for k, n in NEW_SWITCHES]
    )


def downgrade() -> None:
    op.execute(
        "delete from feature_switches where key in ('wave1.escalations', 'wave1.reminders', 'wave1.contact_commands')"
    )
    op.execute("update feature_switches set key = 'wave1.dashboard_actions' where key = 'wave1.approvals'")
    op.drop_index("ix_issue_events_issue_id", table_name="issue_events")
    op.drop_table("issue_events")
