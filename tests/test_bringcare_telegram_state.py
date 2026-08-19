from datetime import datetime, timedelta, timezone

from automation.bringcare_telegram.state import NotificationState


def test_same_event_is_suppressed_for_24_hours(tmp_path):
    state = NotificationState(tmp_path / "state.json")
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    assert state.should_send("captcha:post-1:blocked", now)
    state.mark_sent("captcha:post-1:blocked", now)
    assert not state.should_send("captcha:post-1:blocked", now + timedelta(hours=23))
    assert state.should_send("captcha:post-1:blocked", now + timedelta(hours=24))


def test_changed_status_sends_immediately(tmp_path):
    state = NotificationState(tmp_path / "state.json")
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    state.mark_sent("login:post-1:blocked", now)
    assert state.should_send("login:post-1:resolved", now)
