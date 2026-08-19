import pytest

from automation.bringcare_telegram.events import event_from_blocker


def test_login_expired_maps_to_actionable_event():
    event = event_from_blocker("LOGIN_EXPIRED", "글 제목", "발행 설정", "2026-08-19T09:00:00+09:00")
    assert event.kind == "naver_login_required"
    assert "다시 로그인" in event.action
    assert event.resume_point == "발행 설정"


def test_unknown_blocker_is_rejected():
    with pytest.raises(ValueError):
        event_from_blocker("UNKNOWN", "글", "단계", "now")
