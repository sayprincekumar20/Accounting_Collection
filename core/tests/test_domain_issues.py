from datetime import UTC, datetime

from app.domain.issues import history_row, manila_iso, status_update_data

NOW = datetime(2026, 11, 28, 15, 30, 0, 123456, tzinfo=UTC)


def test_the_time_is_written_like_n8n_does_in_manila_time():
    assert manila_iso(NOW) == "2026-11-28T23:30:00.123+08:00"


def test_status_update_has_the_four_columns_workflow_27_writes_trimmed_like_it():
    data = status_update_data("in_progress", "N" * 100, "x" * 600, NOW)
    assert data == {
        "status": "IN_PROGRESS",
        "handled_by": "N" * 80,
        "handled_at": "2026-11-28T23:30:00.123+08:00",
        "ar_note": "x" * 500,
    }
    assert status_update_data("DONE", "Ana", "", NOW)["ar_note"] == ""


def test_history_row_is_what_workflow_33_writes():
    row = history_row(
        issue_id="I" * 250, issue_kind="system", ref="R" * 100, event="diagnosis", summary="S" * 1200,
        detail={"category": "Google Drive API quota", "recurrence": 2}, actor="AI assistant (asked by Prince)", at="2026-11-28T15:30:00.123Z",
    )  # fmt: skip
    assert row["issue_id"] == "I" * 200 and row["issue_kind"] == "SYSTEM" and row["event"] == "DIAGNOSIS"
    assert row["ref"] == "R" * 80 and row["summary"] == "S" * 1000
    assert row["detail"] == '{"category":"Google Drive API quota","recurrence":2}'
    assert row["actor"] == "AI assistant (asked by Prince)" and row["timestamp"] == "2026-11-28T15:30:00.123Z"


def test_a_detail_that_is_already_text_is_kept_and_a_missing_one_is_empty():
    assert (
        history_row(
            issue_id="a",
            issue_kind="ESCALATION",
            ref="",
            event="NOTE",
            summary="x",
            detail='{"a":1}',
            actor="",
            at="t",
        )["detail"]
        == '{"a":1}'
    )
    assert (
        history_row(
            issue_id="a",
            issue_kind="ESCALATION",
            ref="",
            event="NOTE",
            summary="x",
            detail=None,
            actor="",
            at="t",
        )["detail"]
        == ""
    )
    assert (
        len(
            history_row(
                issue_id="a",
                issue_kind="ESCALATION",
                ref="",
                event="NOTE",
                summary="x",
                detail="d" * 9000,
                actor="",
                at="t",
            )["detail"]
        )
        == 8000
    )
