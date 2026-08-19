from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Iterable


ACTIVE_STATUSES = {"pending", "approved", "publishing"}


class PendingApprovalExists(RuntimeError):
    """Raised when another post already owns the approval slot."""


@dataclass(frozen=True)
class ApprovalRecord:
    post_id: str
    title: str
    post_type: str
    category: str
    status: str
    created_at: str
    expires_at: str
    telegram_update_id: int | None = None
    approved_at: str | None = None
    published_url: str | None = None


@dataclass(frozen=True)
class SyncResult:
    approved: int = 0
    cancelled: int = 0
    last_update_id: int | None = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _datetime(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(timezone.utc)


class ApprovalStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> ApprovalRecord | None:
        if not self.path.exists():
            return None
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return ApprovalRecord(**data)
        except (OSError, ValueError, TypeError):
            return None

    def _write(self, record: ApprovalRecord) -> ApprovalRecord:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=self.path.parent,
            prefix=f".{self.path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            json.dump(asdict(record), handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            temp_path = Path(handle.name)
        os.replace(temp_path, self.path)
        return record

    def create_pending(
        self,
        post_id: str,
        title: str,
        post_type: str,
        category: str,
        *,
        now: datetime | None = None,
    ) -> ApprovalRecord:
        now = now or _utc_now()
        current = self.load()
        if current and current.status in ACTIVE_STATUSES:
            if current.post_id == post_id and current.status == "pending":
                return current
            if _datetime(current.expires_at) > now:
                raise PendingApprovalExists(current.title)
        record = ApprovalRecord(
            post_id=post_id,
            title=title,
            post_type=post_type,
            category=category,
            status="pending",
            created_at=_iso(now),
            expires_at=_iso(now + timedelta(hours=24)),
        )
        return self._write(record)

    def approve(self, *, update_id: int, now: datetime | None = None) -> ApprovalRecord:
        now = now or _utc_now()
        current = self.load()
        if current is None:
            raise RuntimeError("No pending approval")
        if current.status == "approved" and current.telegram_update_id == update_id:
            return current
        if current.status != "pending":
            return current
        if _datetime(current.expires_at) <= now:
            return self._write(ApprovalRecord(**{**asdict(current), "status": "expired"}))
        return self._write(
            ApprovalRecord(
                **{
                    **asdict(current),
                    "status": "approved",
                    "telegram_update_id": update_id,
                    "approved_at": _iso(now),
                }
            )
        )

    def cancel(self, *, update_id: int, now: datetime | None = None) -> ApprovalRecord:
        now = now or _utc_now()
        current = self.load()
        if current is None:
            raise RuntimeError("No pending approval")
        if current.status != "pending":
            return current
        status = "expired" if _datetime(current.expires_at) <= now else "cancelled"
        return self._write(
            ApprovalRecord(
                **{**asdict(current), "status": status, "telegram_update_id": update_id}
            )
        )

    def claim_for_publish(self, *, now: datetime | None = None) -> ApprovalRecord | None:
        now = now or _utc_now()
        current = self.load()
        if current is None or current.status != "approved":
            return None
        if _datetime(current.expires_at) <= now:
            self._write(ApprovalRecord(**{**asdict(current), "status": "expired"}))
            return None
        return self._write(ApprovalRecord(**{**asdict(current), "status": "publishing"}))

    def mark_published(self, url: str) -> ApprovalRecord:
        current = self.load()
        if current is None or current.status != "publishing":
            raise RuntimeError("No publishing approval")
        return self._write(
            ApprovalRecord(**{**asdict(current), "status": "published", "published_url": url})
        )


class UpdateOffsetStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def load(self) -> int | None:
        if not self.path.exists():
            return None
        try:
            value = json.loads(self.path.read_text(encoding="utf-8")).get("offset")
            return value if isinstance(value, int) and value >= 0 else None
        except (OSError, ValueError, TypeError, AttributeError):
            return None

    def save(self, offset: int) -> int:
        current = self.load()
        value = max(int(offset), current if current is not None else 0)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.path.parent, prefix=".offset.", suffix=".tmp", delete=False
        ) as handle:
            json.dump({"offset": value}, handle)
            handle.write("\n")
            temp_path = Path(handle.name)
        os.replace(temp_path, self.path)
        return value


def apply_updates(
    updates: Iterable[dict[str, Any]],
    *,
    allowed_chat_id: str,
    store: ApprovalStore,
    now: datetime | None = None,
) -> SyncResult:
    approved = 0
    cancelled = 0
    last_update_id: int | None = None
    for update in updates:
        update_id = update.get("update_id")
        if isinstance(update_id, int):
            last_update_id = update_id if last_update_id is None else max(last_update_id, update_id)
        message = update.get("message")
        if not isinstance(message, dict) or not isinstance(update_id, int):
            continue
        chat = message.get("chat")
        if not isinstance(chat, dict):
            continue
        if chat.get("type") != "private" or str(chat.get("id")) != str(allowed_chat_id):
            continue
        text = message.get("text")
        if not isinstance(text, str):
            continue
        command = text.strip()
        before = store.load()
        if before is None or before.status != "pending":
            continue
        if command == "승인":
            after = store.approve(update_id=update_id, now=now)
            if after.status == "approved":
                approved += 1
        elif command == "취소":
            after = store.cancel(update_id=update_id, now=now)
            if after.status == "cancelled":
                cancelled += 1
    return SyncResult(approved=approved, cancelled=cancelled, last_update_id=last_update_id)
