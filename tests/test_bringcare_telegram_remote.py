import json
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone

import pytest

from automation.bringcare_telegram.approval import ApprovalStore, UpdateOffsetStore
from automation.bringcare_telegram.queries import BlogQueries
from automation.bringcare_telegram.revisions import RevisionStore
from automation.bringcare_telegram.remote import RemoteProcessor


NOW = datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc)


def update(update_id, text=None, *, chat_id=1234, chat_type="private"):
    message = {"chat": {"id": chat_id, "type": chat_type}}
    if text is not None:
        message["text"] = text
    return {"update_id": update_id, "message": message}


def processor(tmp_path, *, pending=True):
    approval = ApprovalStore(tmp_path / "approval.json")
    if pending:
        approval.create_pending(
            "post-1", "원룸 관리", "검색정보", "생활 속 관리정보", now=NOW
        )
    revisions = RevisionStore(tmp_path / "revisions.json")
    queries = BlogQueries(tmp_path, approval_path=approval.path, clock=lambda: NOW)
    replies = []
    offsets = UpdateOffsetStore(tmp_path / "offset.json")
    remote = RemoteProcessor(
        allowed_chat_id="1234",
        approval_store=approval,
        revision_store=revisions,
        queries=queries,
        reply=lambda chat_id, text: replies.append((chat_id, text)),
        update_state=offsets,
    )
    return remote, approval, revisions, replies, offsets


def test_orders_updates_silences_unauthorized_and_advances_past_ignored(tmp_path):
    remote, approval, _, replies, offsets = processor(tmp_path)

    result = remote.process(
        [
            update(4, "취소", chat_id=9999),
            {"update_id": 3, "message": {"chat": {"id": 1234, "type": "group"}}},
            update(2, "승인"),
            update(1, None),
        ],
        now=NOW,
    )

    assert approval.load().status == "approved"
    assert replies == [("1234", "승인했습니다. 발행 작업이 이어서 처리됩니다.")]
    assert (result.replies, result.actions, result.approved, result.cancelled) == (1, 1, 1, 0)
    assert result.last_update_id == offsets.load() == 4
    with pytest.raises(FrozenInstanceError):
        result.actions = 9


def test_duplicate_and_old_update_ids_are_idempotent(tmp_path):
    remote, _, revisions, replies, offsets = processor(tmp_path)
    offsets.save(8)

    result = remote.process([update(8, "제목: 오래됨"), update(9, "제목: 새 제목"), update(9, "제목: 중복")], now=NOW)

    assert [(row.update_id, row.content) for row in revisions.list()] == [(9, "새 제목")]
    assert len(replies) == 1
    assert result.last_update_id == 9


@pytest.mark.parametrize(
    ("command", "prefix"),
    [
        ("어디까지 됐어", "현재 상태:"),
        ("승인 기다리는 글 보여줘", "대기 글:"),
        ("최근에 뭐 올렸어", "최근 발행:"),
        ("다음 글 몇 시야", "다음 준비 시각:"),
        ("오늘 성과 알려줘", "오늘 성과:"),
        ("뭐가 문제야", "최근 오류:"),
    ],
)
def test_dispatches_each_read_only_query(tmp_path, command, prefix):
    remote, _, _, replies, _ = processor(tmp_path)

    result = remote.process([update(1, command)], now=NOW)

    assert replies[0][1].startswith(prefix)
    assert result.actions == 0


def test_revision_requires_target_then_stores_parsed_payload_and_update_id(tmp_path):
    remote, _, revisions, replies, _ = processor(tmp_path)
    result = remote.process([update(7, "제목: <b>새 & 제목</b>")], now=NOW)

    record = revisions.list()[0]
    assert (record.post_id, record.kind, record.content, record.update_id) == (
        "post-1", "title", "<b>새 & 제목</b>", 7
    )
    assert "&lt;b&gt;새 &amp; 제목&lt;/b&gt;" in replies[0][1]
    assert "아직 발행되지 않았습니다" in replies[0][1]
    assert result.actions == 1

    no_target, _, empty, no_target_replies, _ = processor(tmp_path / "other", pending=False)
    rejected = no_target.process([update(8, "본문에서 짧게 수정해줘")], now=NOW)
    assert empty.list() == []
    assert "대상 글" in no_target_replies[0][1]
    assert rejected.actions == 0


def test_publish_request_reuses_target_as_ten_minute_pending_and_never_publishes(tmp_path):
    remote, approval, _, replies, _ = processor(tmp_path)

    requested_at = NOW + timedelta(hours=2)

    result = remote.process([update(5, "올려줘")], now=requested_at)

    record = approval.load()
    assert record.status == "pending"
    assert record.created_at == requested_at.isoformat()
    assert record.expires_at == (requested_at + timedelta(minutes=10)).isoformat()
    assert "원룸 관리" in replies[0][1]
    assert "정확히 승인" in replies[0][1]
    assert "10분" in replies[0][1]
    assert result.actions == 1 and result.approved == 0


@pytest.mark.parametrize("prior_status", ["expired", "cancelled"])
def test_publish_request_rearms_expired_or_cancelled_known_post(tmp_path, prior_status):
    remote, approval, _, replies, _ = processor(tmp_path)
    if prior_status == "expired":
        approval.approve(update_id=20, now=NOW + timedelta(days=2))
    else:
        approval.cancel(update_id=20, now=NOW)
    requested_at = NOW + timedelta(days=3)

    result = remote.process([update(21, "올려줘")], now=requested_at)

    record = approval.load()
    assert record.status == "pending"
    assert record.created_at == requested_at.isoformat()
    assert record.expires_at == (requested_at + timedelta(minutes=10)).isoformat()
    assert record.telegram_update_id is None
    assert record.approved_at is None
    assert record.published_url is None
    assert "정확히 승인" in replies[0][1]
    assert "아직 발행하지 않았습니다" in replies[0][1]
    assert result.actions == 1 and result.approved == 0


def test_publish_request_does_not_rearm_published_post(tmp_path):
    remote, approval, _, replies, _ = processor(tmp_path)
    approval.approve(update_id=30, now=NOW)
    approval.claim_for_publish(now=NOW)
    approval.mark_published("https://example.com/post-1")

    result = remote.process([update(31, "올려줘")], now=NOW)

    assert approval.load().status == "published"
    assert "대상 글이 없습니다" in replies[0][1]
    assert result.actions == 0


@pytest.mark.parametrize(("word", "status", "field"), [("승인", "approved", "approved"), ("취소", "cancelled", "cancelled")])
def test_exact_approval_commands_act_on_current_pending(word, status, field, tmp_path):
    remote, approval, _, replies, _ = processor(tmp_path)
    result = remote.process([update(11, word)], now=NOW)
    assert approval.load().status == status
    assert getattr(result, field) == 1
    assert len(replies) == 1


def test_approval_without_pending_is_safe(tmp_path):
    remote, approval, _, replies, _ = processor(tmp_path, pending=False)
    result = remote.process([update(1, "승인"), update(2, "취소")], now=NOW)
    assert approval.load() is None
    assert result.actions == result.approved == result.cancelled == 0
    assert len(replies) == 2


@pytest.mark.parametrize("text", ["승인?", "승인!", "승인...", "취소!"])
def test_mutation_confirmation_requires_raw_trimmed_exact_text(tmp_path, text):
    remote, approval, _, replies, _ = processor(tmp_path)
    before = approval.load()

    result = remote.process([update(12, f"  {text}  ")], now=NOW)

    assert approval.load() == before
    assert result.actions == result.approved == result.cancelled == 0
    assert "도움말" in replies[0][1]


def test_publish_refresh_race_replies_safely_and_advances_offset(tmp_path):
    from automation.bringcare_telegram.approval import PendingApprovalMismatch

    class RacingApprovalStore(ApprovalStore):
        def refresh_pending(self, post_id, *, now=None, ttl_minutes=10):
            self.approve(update_id=99, now=now)
            return super().refresh_pending(post_id, now=now, ttl_minutes=ttl_minutes)

    approval = RacingApprovalStore(tmp_path / "approval.json")
    approval.create_pending("post-1", "원룸 관리", "검색정보", "생활 속 관리정보", now=NOW)
    replies = []
    offsets = UpdateOffsetStore(tmp_path / "offset.json")
    remote = RemoteProcessor(
        allowed_chat_id="1234",
        approval_store=approval,
        revision_store=RevisionStore(tmp_path / "revisions.json"),
        queries=BlogQueries(tmp_path, approval_path=approval.path),
        reply=lambda chat_id, text: replies.append((chat_id, text)),
        update_state=offsets,
    )

    result = remote.process([update(15, "올려줘")], now=NOW)

    assert "상태가 변경" in replies[0][1]
    assert result.actions == 0
    assert result.last_update_id == offsets.load() == 15


@pytest.mark.parametrize("text", ["임의 명령", "제목 바꾸고 본문도 수정해줘"])
def test_unknown_and_ambiguous_are_helpful_without_side_effects(tmp_path, text):
    remote, approval, revisions, replies, _ = processor(tmp_path)
    before = approval.load()
    result = remote.process([update(1, text)], now=NOW)
    assert approval.load() == before and revisions.list() == []
    assert "도움말" in replies[0][1]
    assert result.actions == 0


def test_help_is_concise_and_malicious_input_is_not_echoed_or_executed(tmp_path):
    remote, _, revisions, replies, _ = processor(tmp_path)
    secret = "BOT_TOKEN=123456:abcdef<script>alert(1)</script>"
    remote.process([update(1, "도움말"), update(2, secret)], now=NOW)
    assert "어디까지 됐어" in replies[0][1] and "승인" in replies[0][1]
    assert secret not in "\n".join(text for _, text in replies)
    assert revisions.list() == []


def test_non_integer_update_does_not_change_offset(tmp_path):
    remote, _, _, replies, offsets = processor(tmp_path)
    result = remote.process([update(True, "승인"), {"update_id": "3"}], now=NOW)
    assert result.last_update_id is None and offsets.load() is None and replies == []


def test_result_offset_remains_monotonic_when_batch_contains_only_old_or_negative_ids(tmp_path):
    remote, _, _, replies, offsets = processor(tmp_path)
    offsets.save(8)

    result = remote.process([update(7, "도움말"), update(-1, "승인")], now=NOW)

    assert result.last_update_id == offsets.load() == 8
    assert replies == []
