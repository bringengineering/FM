from datetime import datetime, timedelta, timezone

import pytest


NOW = datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc)


def test_ten_minute_approval_succeeds_within_ttl_and_expires_after_it(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")
    created = store.create_pending(
        "post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW, ttl_minutes=10
    )

    assert created.expires_at == (NOW + timedelta(minutes=10)).isoformat()
    assert store.approve(update_id=101, now=NOW + timedelta(minutes=9, seconds=59)).status == "approved"

    expired_store = ApprovalStore(tmp_path / "expired-approval.json")
    expired_store.create_pending(
        "post-2", "제목", "검색정보", "생활 속 관리정보", now=NOW, ttl_minutes=10
    )
    assert expired_store.approve(
        update_id=102, now=NOW + timedelta(minutes=10, seconds=1)
    ).status == "expired"


@pytest.mark.parametrize("ttl_minutes", [True, False, 1.5, "10", None, 0, -1, 1441])
def test_create_pending_rejects_invalid_ttl_minutes(tmp_path, ttl_minutes):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")

    with pytest.raises((TypeError, ValueError)):
        store.create_pending(
            "post-1",
            "제목",
            "검색정보",
            "생활 속 관리정보",
            now=NOW,
            ttl_minutes=ttl_minutes,
        )


def test_custom_ttl_normalizes_timezone_aware_expiry_to_utc(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")
    korea_now = datetime(2026, 8, 19, 21, 0, tzinfo=timezone(timedelta(hours=9)))

    created = store.create_pending(
        "post-1", "제목", "검색정보", "생활 속 관리정보", now=korea_now, ttl_minutes=10
    )

    assert created.created_at == NOW.isoformat()
    assert created.expires_at == (NOW + timedelta(minutes=10)).isoformat()


def test_pending_to_approved_is_single_use(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)

    assert store.approve(update_id=101, now=NOW).status == "approved"
    assert store.approve(update_id=101, now=NOW).status == "approved"
    assert store.load().telegram_update_id == 101


def test_expired_pending_cannot_be_approved(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)

    assert store.approve(update_id=102, now=NOW + timedelta(hours=25)).status == "expired"


def test_existing_live_pending_cannot_be_overwritten(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore, PendingApprovalExists

    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "첫 글", "검색정보", "생활 속 관리정보", now=NOW)

    with pytest.raises(PendingApprovalExists):
        store.create_pending("post-2", "둘째 글", "검색정보", "생활 속 관리정보", now=NOW)


def test_repeating_same_pending_post_keeps_original_approval_window(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")
    original = store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)

    repeated = store.create_pending(
        "post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW + timedelta(hours=23)
    )

    assert repeated.created_at == original.created_at
    assert repeated.expires_at == original.expires_at


def test_only_approved_record_can_be_claimed_for_publish(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    assert store.claim_for_publish(now=NOW) is None

    store.approve(update_id=103, now=NOW)
    claimed = store.claim_for_publish(now=NOW)
    assert claimed.status == "publishing"
    assert store.claim_for_publish(now=NOW) is None


def test_sync_accepts_only_registered_private_chat(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore, apply_updates

    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    updates = [
        {"update_id": 1, "message": {"chat": {"id": 1234, "type": "private"}, "text": "승인"}},
        {"update_id": 2, "message": {"chat": {"id": 9999, "type": "private"}, "text": "승인"}},
        {"update_id": 3, "message": {"chat": {"id": 1234, "type": "private"}, "text": "승인해줘"}},
    ]

    result = apply_updates(updates, allowed_chat_id="1234", store=store, now=NOW)

    assert result.approved == 1
    assert result.cancelled == 0
    assert result.last_update_id == 3
    assert store.load().telegram_update_id == 1


def test_cancel_command_cancels_pending(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore, apply_updates

    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    updates = [
        {"update_id": 7, "message": {"chat": {"id": 1234, "type": "private"}, "text": " 취소 "}},
    ]

    result = apply_updates(updates, allowed_chat_id="1234", store=store, now=NOW)

    assert result.cancelled == 1
    assert store.load().status == "cancelled"


def test_update_offset_is_atomic_and_monotonic(tmp_path):
    from automation.bringcare_telegram.approval import UpdateOffsetStore

    offsets = UpdateOffsetStore(tmp_path / "offset.json")
    assert offsets.load() is None
    offsets.save(8)
    offsets.save(4)
    assert offsets.load() == 8
