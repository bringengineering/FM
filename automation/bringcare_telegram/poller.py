"""Long-running, local-only supervisor for Telegram remote commands."""

from __future__ import annotations

from contextlib import AbstractContextManager
import logging
import os
from pathlib import Path
import sys
import time
from typing import Callable

from .cli import process_remote_once
from .client import (
    TelegramAuthError,
    TelegramForbiddenError,
    TelegramRateLimitError,
    TelegramTemporaryError,
)


LOGGER = logging.getLogger("bringcare.telegram.poller")
STATE_DIR = Path(__file__).resolve().parents[1] / "state"
LOCK_PATH = STATE_DIR / "bringcare-telegram-poller.lock"
TRANSIENT_ERRORS = (
    TelegramTemporaryError,
    TelegramRateLimitError,
)


class PollerLockError(RuntimeError):
    """Raised when another poller owns the process-lifetime lock."""


class SingleInstanceLock(AbstractContextManager):
    """Kernel-backed nonblocking lock with a diagnostic PID sidecar."""

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
            raise PollerLockError("another poller is already running") from None
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


def run_poller(
    *,
    runner: Callable[..., dict] = process_remote_once,
    lock: AbstractContextManager | None = None,
    sleep: Callable[[float], None] = time.sleep,
    timeout: int = 50,
    initial_backoff: float = 1,
    max_backoff: float = 30,
    idle_sleep: float = 0.1,
) -> int:
    if not 0 <= timeout <= 50:
        raise ValueError("timeout must be between 0 and 50 seconds")
    if initial_backoff <= 0 or max_backoff < initial_backoff:
        raise ValueError("backoff bounds are invalid")

    try:
        with lock if lock is not None else SingleInstanceLock():
            delay = initial_backoff
            LOGGER.info("status=started")
            while True:
                try:
                    result = runner(timeout=timeout)
                    delay = initial_backoff
                    LOGGER.info("status=polled")
                    if isinstance(result, dict) and result.get("updates") == 0:
                        sleep(idle_sleep)
                except TRANSIENT_ERRORS:
                    LOGGER.warning("status=temporary_error retry_seconds=%s", delay)
                    sleep(delay)
                    delay = min(max_backoff, delay * 2)
    except PollerLockError:
        LOGGER.error("status=already_running")
        return 2
    except KeyboardInterrupt:
        LOGGER.info("status=stopped")
        return 0


def main(*, runner=process_remote_once, lock=None, sleep=time.sleep) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        return run_poller(runner=runner, lock=lock, sleep=sleep)
    except (FileNotFoundError, ValueError, KeyError):
        LOGGER.error("status=fatal_config_error")
        return 3
    except (TelegramAuthError, TelegramForbiddenError):
        LOGGER.error("status=fatal_auth_error")
        return 4
    except Exception:
        LOGGER.error("status=fatal_unexpected_error")
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
