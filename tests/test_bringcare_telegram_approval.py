from datetime import datetime, timedelta, timezone
import multiprocessing
import threading

import pytest

from automation.bringcare_telegram.approval import ApprovalStore


NOW = datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc)


class _ProcessPausingApprovalStore(ApprovalStore):
    def __init__(self, path, waiting, release):
        super().__init__(path)
        self.waiting = waiting
        self.release = release

    def _write(self, record):
        if record.status == "pending" and record.created_at == (NOW + timedelta(hours=1)).isoformat():
            self.waiting.set()
            if not self.release.wait(5):
                raise TimeoutError("test refresh was not released")
        return super()._write(record)


def _process_refresh(path, waiting, release):
    _ProcessPausingApprovalStore(path, waiting, release).refresh_pending(
        "post-1", now=NOW + timedelta(hours=1)
    )


def _process_approve(path, done):
    ApprovalStore(path).approve(update_id=66, now=NOW + timedelta(hours=1))
    done.set()


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


def test_refresh_transaction_cannot_overwrite_concurrent_approval(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    refresh_waiting = threading.Event()
    release_refresh = threading.Event()

    class PausingStore(ApprovalStore):
        def _write(self, record):
            if record.status == "pending" and record.created_at == (NOW + timedelta(hours=1)).isoformat():
                refresh_waiting.set()
                assert release_refresh.wait(2)
            return super()._write(record)

    store = PausingStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    approve_done = threading.Event()

    refresh_thread = threading.Thread(
        target=lambda: store.refresh_pending("post-1", now=NOW + timedelta(hours=1))
    )
    approve_thread = threading.Thread(
        target=lambda: (store.approve(update_id=44, now=NOW + timedelta(hours=1)), approve_done.set())
    )
    refresh_thread.start()
    assert refresh_waiting.wait(2)
    approve_thread.start()
    try:
        assert not approve_done.wait(0.2)
    finally:
        release_refresh.set()
        refresh_thread.join(2)
        approve_thread.join(2)

    assert not refresh_thread.is_alive() and not approve_thread.is_alive()
    assert store.load().status == "approved"
    assert store.load().telegram_update_id == 44


def test_simultaneous_approve_and_claim_leave_a_valid_serial_state(tmp_path):
    from automation.bringcare_telegram.approval import ApprovalStore

    store = ApprovalStore(tmp_path / "approval.json")
    store.create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    start = threading.Barrier(3)

    def approve():
        start.wait()
        store.approve(update_id=55, now=NOW)

    def claim():
        start.wait()
        store.claim_for_publish(now=NOW)

    threads = [threading.Thread(target=approve), threading.Thread(target=claim)]
    for thread in threads:
        thread.start()
    start.wait()
    for thread in threads:
        thread.join(2)

    record = store.load()
    assert record.status in {"approved", "publishing"}
    assert record.telegram_update_id == 55


def test_cross_process_refresh_cannot_overwrite_concurrent_approval(tmp_path):
    path = tmp_path / "approval.json"
    ApprovalStore(path).create_pending("post-1", "제목", "검색정보", "생활 속 관리정보", now=NOW)
    context = multiprocessing.get_context("spawn")
    waiting, release, approve_done = context.Event(), context.Event(), context.Event()
    refresh = context.Process(target=_process_refresh, args=(path, waiting, release))
    approve = context.Process(target=_process_approve, args=(path, approve_done))

    refresh.start()
    assert waiting.wait(5)
    approve.start()
    try:
        assert not approve_done.wait(0.3)
    finally:
        release.set()
        refresh.join(5)
        approve.join(5)

    assert refresh.exitcode == approve.exitcode == 0
    record = ApprovalStore(path).load()
    assert record.status == "approved"
    assert record.telegram_update_id == 66
