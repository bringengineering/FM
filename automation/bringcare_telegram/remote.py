"""Authorized, idempotent processing of Telegram blog commands."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from html import escape
from typing import Any, Callable, Iterable, Protocol

from .approval import ApprovalStore, PendingApprovalExists, PendingApprovalMismatch
from .queries import BlogQueries
from .revisions import RevisionStore
from .router import route


class UpdateState(Protocol):
    def load(self) -> int | None: ...

    def save(self, offset: int) -> int: ...


@dataclass(frozen=True)
class RemoteResult:
    replies: int = 0
    actions: int = 0
    approved: int = 0
    cancelled: int = 0
    last_update_id: int | None = None


_QUERY_METHODS = {
    "status": "current_status",
    "pending": "pending_post",
    "latest": "latest_publications",
    "schedule": "next_preparation_time",
    "performance": "today_performance",
    "error": "latest_error",
}
_ACTIVE_TARGET_STATUSES = {"pending", "approved", "publishing"}
_PUBLISH_TARGET_STATUSES = {"pending", "expired", "cancelled"}
_HELP = (
    "지원 예시: 어디까지 됐어 · 승인 기다리는 글 보여줘 · 최근에 뭐 올렸어 · "
    "제목: 새 제목 · 올려줘 · 승인 · 취소"
)


class RemoteProcessor:
    def __init__(
        self,
        *,
        allowed_chat_id: str,
        approval_store: ApprovalStore,
        revision_store: RevisionStore,
        queries: BlogQueries,
        reply: Callable[[str, str], Any],
        update_state: UpdateState,
    ):
        self.allowed_chat_id = str(allowed_chat_id)
        self.approval_store = approval_store
        self.revision_store = revision_store
        self.queries = queries
        self.reply = reply
        self.update_state = update_state

    def _target(self):
        record = self.approval_store.load()
        return record if record is not None and record.status in _ACTIVE_TARGET_STATUSES else None

    def _publish_target(self):
        record = self.approval_store.load()
        return record if record is not None and record.status in _PUBLISH_TARGET_STATUSES else None

    def _reply(self, chat_id: object, text: str) -> None:
        self.reply(str(chat_id), escape(text, quote=True))

    def process(
        self, updates: Iterable[dict[str, Any]], *, now: datetime | None = None
    ) -> RemoteResult:
        previous = self.update_state.load()
        valid = []
        for update in updates:
            if not isinstance(update, dict):
                continue
            update_id = update.get("update_id")
            if (
                not isinstance(update_id, int)
                or isinstance(update_id, bool)
                or update_id < 0
            ):
                continue
            valid.append((update_id, update))

        observed = [item[0] for item in valid]
        if previous is not None:
            observed.append(previous)
        last_update_id = max(observed, default=None)
        replies = actions = approved = cancelled = 0
        seen: set[int] = set()
        for update_id, update in sorted(valid, key=lambda item: item[0]):
            if update_id in seen or (previous is not None and update_id <= previous):
                continue
            seen.add(update_id)
            message = update.get("message")
            if not isinstance(message, dict):
                continue
            chat = message.get("chat")
            if (
                not isinstance(chat, dict)
                or chat.get("type") != "private"
                or str(chat.get("id")) != self.allowed_chat_id
            ):
                continue
            text = message.get("text")
            if not isinstance(text, str):
                continue

            command = route(text)
            raw_command = text.strip()
            if command.intent in {"approve", "cancel"} and raw_command not in {
                "승인",
                "취소",
                "보류",
            }:
                command = route("")
            answer: str
            if command.intent in _QUERY_METHODS:
                answer = getattr(self.queries, _QUERY_METHODS[command.intent])()
            elif command.intent == "help":
                answer = _HELP
            elif command.intent in {"unknown", "ambiguous"}:
                qualifier = "한 번에 한 가지 명령만 보내 주세요. " if command.intent == "ambiguous" else ""
                answer = qualifier + "지원하지 않는 명령입니다. 도움말을 보내 예시를 확인해 주세요."
            elif command.intent in {"revise_title", "revise_body"}:
                target = self._target()
                if target is None:
                    answer = "수정할 대상 글이 없습니다. 먼저 승인 대기 글을 준비해 주세요."
                else:
                    kind = "title" if command.intent == "revise_title" else "body"
                    self.revision_store.add(update_id, target.post_id, kind, command.payload or "", now=now)
                    label = "최종 제목" if kind == "title" else "최종 본문 수정 요청"
                    answer = f"{label}: {command.payload}\n수정 요청만 저장했으며 아직 발행되지 않았습니다."
                    actions += 1
            elif command.intent == "publish_request":
                target = self._publish_target()
                if target is None:
                    answer = "발행할 대상 글이 없습니다. 먼저 승인 대기 글을 준비해 주세요."
                else:
                    try:
                        pending = self.approval_store.refresh_pending(
                            target.post_id,
                            now=now,
                            ttl_minutes=10,
                        )
                        answer = (
                            f"발행 승인 요청: {pending.title}\n10분 안에 정확히 승인이라고 보내 주세요. "
                            "아직 발행하지 않았습니다."
                        )
                        actions += 1
                    except PendingApprovalExists:
                        answer = "다른 글의 승인 요청이 진행 중입니다. 현재 대기 글을 먼저 확인해 주세요."
                    except PendingApprovalMismatch:
                        answer = "승인 대기 상태가 변경되어 요청을 만들지 않았습니다. 현재 상태를 다시 확인해 주세요."
            elif command.intent in {"approve", "cancel"}:
                before = self.approval_store.load()
                if before is None or before.status != "pending":
                    answer = "현재 처리할 승인 대기 요청이 없습니다."
                elif command.intent == "approve":
                    after = self.approval_store.approve(update_id=update_id, now=now)
                    if after.status == "approved":
                        answer = "승인했습니다. 발행 작업이 이어서 처리됩니다."
                        approved += 1
                        actions += 1
                    else:
                        answer = "승인 요청이 만료되어 처리하지 않았습니다."
                else:
                    after = self.approval_store.cancel(update_id=update_id, now=now)
                    if after.status == "cancelled":
                        answer = "승인 요청을 취소했습니다."
                        cancelled += 1
                        actions += 1
                    else:
                        answer = "승인 요청이 만료되어 처리하지 않았습니다."
            else:  # defensive fallback for future router intents
                answer = "지원하지 않는 명령입니다. 도움말을 보내 예시를 확인해 주세요."

            self._reply(chat.get("id"), answer)
            replies += 1

        if last_update_id is not None:
            self.update_state.save(last_update_id)
        return RemoteResult(replies, actions, approved, cancelled, last_update_id)


__all__ = ["RemoteProcessor", "RemoteResult", "UpdateState"]
