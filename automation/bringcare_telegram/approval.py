from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Iterable

if os.name == "nt":
    import msvcrt
else:
    import fcntl


ACTIVE_STATUSES = {"pending", "approved", "publishing"}
_THREAD_LOCKS: dict[str, threading.Lock] = {}
_THREAD_LOCKS_GUARD = threading.Lock()


class PendingApprovalExists(RuntimeError):
    """Raised when another post already owns the approval slot."""


class PendingApprovalMismatch(RuntimeError):
    """Raised when the pending approval changed before an explicit refresh."""


class ApprovalStoreLockTimeout(TimeoutError):
    """Raised when another approval transaction holds the lock too long."""


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


@contextmanager
def _exclusive_file_lock(path: Path, timeout: float):
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout
    lock_key = str(path.resolve())
    with _THREAD_LOCKS_GUARD:
        thread_lock = _THREAD_LOCKS.setdefault(lock_key, threading.Lock())
    if not thread_lock.acquire(timeout=max(0.0, deadline - time.monotonic())):
        raise ApprovalStoreLockTimeout(f"Timed out acquiring approval store lock: {path}")
    try:
        with path.open("a+b") as handle:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            acquired = False
            while not acquired:
                try:
                    handle.seek(0)
                    if os.name == "nt":
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                except OSError as exc:
                    if time.monotonic() >= deadline:
                        raise ApprovalStoreLockTimeout(
                            f"Timed out acquiring approval store lock: {path}"
                        ) from exc
                    time.sleep(min(0.05, max(0.0, deadline - time.monotonic())))
            try:
                yield
            finally:
                handle.seek(0)
                if os.name == "nt":
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        thread_lock.release()


class ApprovalStore:
    def __init__(self, path: str | Path, *, lock_timeout: float = 5.0):
        self.path = Path(path)
        if lock_timeout < 0:
            raise ValueError("lock_timeout must be non-negative")
        self.lock_timeout = lock_timeout
        self.lock_path = self.path.with_name(f"{self.path.name}.lock")

    def _locked(self):
        return _exclusive_file_lock(self.lock_path, self.lock_timeout)

    def load(self) -> ApprovalRecord | None:
        return self._load_unlocked()

    def _load_unlocked(self) -> ApprovalRecord | None:
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
        ttl_minutes: int = 1440,
    ) -> ApprovalRecord:
        if isinstance(ttl_minutes, bool) or not isinstance(ttl_minutes, int):
            raise TypeError("ttl_minutes must be an integer")
        if not 1 <= ttl_minutes <= 1440:
            raise ValueError("ttl_minutes must be between 1 and 1440")
        now = datetime.fromisoformat(_iso(now or _utc_now()))
        with self._locked():
            current = self._load_unlocked()
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
                expires_at=_iso(now + timedelta(minutes=ttl_minutes)),
            )
            return self._write(record)

    def refresh_pending(
        self,
        post_id: str,
        *,
        now: datetime | None = None,
        ttl_minutes: int = 10,
    ) -> ApprovalRecord:
        """Start a fresh approval window for the named current pending post."""
        if not isinstance(post_id, str) or not post_id.strip():
            raise ValueError("post_id must be a non-empty string")
        if isinstance(ttl_minutes, bool) or not isinstance(ttl_minutes, int):
            raise TypeError("ttl_minutes must be an integer")
        if not 1 <= ttl_minutes <= 1440:
            raise ValueError("ttl_minutes must be between 1 and 1440")
        with self._locked():
            current = self._load_unlocked()
            if (
                current is None
                or current.status not in {"pending", "expired", "cancelled"}
                or current.post_id != post_id.strip()
            ):
                raise PendingApprovalMismatch("No matching pending approval")
            timestamp = datetime.fromisoformat(_iso(now or _utc_now()))
            return self._write(
                ApprovalRecord(
                    **{
                        **asdict(current),
                        "status": "pending",
                        "created_at": _iso(timestamp),
                        "expires_at": _iso(timestamp + timedelta(minutes=ttl_minutes)),
                        "telegram_update_id": None,
                        "approved_at": None,
                        "published_url": None,
                    }
                )
            )

    def approve(self, *, update_id: int, now: datetime | None = None) -> ApprovalRecord:
        now = now or _utc_now()
        with self._locked():
            current = self._load_unlocked()
            if current is None:
                raise RuntimeError("No pending approval")
            if current.status == "approved" and current.telegram_update_id == update_id:
                return current
            if current.status != "pending":
                return current
            if _datetime(current.expires_at) <= now:
                return self._write(ApprovalRecord(**{**asdict(current), "status": "expired"}))
            return self._write(ApprovalRecord(**{**asdict(current), "status": "approved", "telegram_update_id": update_id, "approved_at": _iso(now)}))

    def cancel(self, *, update_id: int, now: datetime | None = None) -> ApprovalRecord:
        now = now or _utc_now()
        with self._locked():
            current = self._load_unlocked()
            if current is None:
                raise RuntimeError("No pending approval")
            if current.status != "pending":
                return current
            status = "expired" if _datetime(current.expires_at) <= now else "cancelled"
            return self._write(ApprovalRecord(**{**asdict(current), "status": status, "telegram_update_id": update_id}))

    def claim_for_publish(self, *, now: datetime | None = None) -> ApprovalRecord | None:
        now = now or _utc_now()
        with self._locked():
            current = self._load_unlocked()
            if current is None or current.status != "approved":
                return None
            if _datetime(current.expires_at) <= now:
                self._write(ApprovalRecord(**{**asdict(current), "status": "expired"}))
                return None
            return self._write(ApprovalRecord(**{**asdict(current), "status": "publishing"}))

    def mark_published(self, url: str) -> ApprovalRecord:
        with self._locked():
            current = self._load_unlocked()
            if current is None or current.status != "publishing":
                raise RuntimeError("No publishing approval")
            return self._write(ApprovalRecord(**{**asdict(current), "status": "published", "published_url": url}))


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
