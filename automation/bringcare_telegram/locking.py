from __future__ import annotations

from contextlib import AbstractContextManager
import os
from pathlib import Path


STATE_DIR = Path(__file__).resolve().parents[1] / "state"
LOCK_PATH = STATE_DIR / "bringcare-telegram-poller.lock"


class PollerLockError(RuntimeError):
    """Raised when another Telegram update consumer owns the lock."""


class SingleInstanceLock(AbstractContextManager):
    def __init__(self, path: Path = LOCK_PATH):
        self.path = Path(path)
        self._file = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        try:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            handle.close()
            raise PollerLockError("another Telegram consumer is already running") from None
        handle.seek(0)
        handle.truncate()
        handle.write(str(os.getpid()).encode("ascii"))
        handle.flush()
        self._file = handle
        return self

    def __exit__(self, *_):
        handle, self._file = self._file, None
        if handle is None:
            return False
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
        return False


__all__ = ["LOCK_PATH", "PollerLockError", "SingleInstanceLock"]
